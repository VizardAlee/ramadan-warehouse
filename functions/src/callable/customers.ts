import { AggregateField, FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import { accountingPeriodReference, assertAccountingPeriodOpen } from "../accounting/period-lock.js";
import { bankAccountSummary, resolveSettlementAccount } from "../accounting/settlement-account.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import {
  hasRole,
  hasServerPermission,
  requireAccess,
  requireBranchScope,
  requirePermission,
} from "../auth/authorize.js";
import { enforceAppCheck } from "../config.js";
import { uniquenessDocumentId } from "../inventory/calculations.js";
import { assertBalancedJournal } from "../sales/calculations.js";
import { customerArrangements, changeArrangementBalance, selectedArrangement, upsertArrangement } from "../sales/customer-arrangements.js";
import { changeMoneyBalance, legacyDebt, moneyBalances, reduceInvoice, UNDATED_DEBT } from "../sales/receivables.js";
import { correlationId, parseInput } from "../utils/callable.js";
import {
  customerPaymentInput,
  customerHistoryInput,
  decideCustomerCreditInput,
  saveCustomerInput,
} from "../validation/sales.js";

export const getCustomerHistory = onCall({ enforceAppCheck }, async (request) => {
  const actor = await requireAccess(request);
  requirePermission(actor, "customers.read");
  const input = parseInput(customerHistoryInput, request.data);
  const customer = await db.doc(`customers/${input.customerId}`).get();
  if (!customer.exists || customer.get("organizationId") !== actor.organizationId)
    throw new HttpsError("not-found", "Customer not found.");
  const allBranches = hasServerPermission(actor, "sales.read.all");
  const branchId = input.branchId ?? (!allBranches && actor.branchIds.length === 1 ? actor.branchIds[0] : undefined);
  if (!allBranches && !branchId)
    throw new HttpsError("invalid-argument", "Select an assigned branch for this customer history.");
  if (branchId) requireBranchScope(actor, branchId);
  if (input.view === "receivables") {
    let base: FirebaseFirestore.Query = db.collection("sales").where("organizationId", "==", actor.organizationId).where("customerId", "==", customer.id).where("receivableStatus", "==", "open");
    if (branchId) base = base.where("branchId", "==", branchId);
    let page = base.orderBy("receivableDueDate").orderBy("__name__");
    if (input.cursor?.sale) {
      const start = await db.doc(`sales/${input.cursor.sale}`).get();
      if (!start.exists || start.get("organizationId") !== actor.organizationId || start.get("customerId") !== customer.id || (branchId && start.get("branchId") !== branchId) || start.get("receivableVersion") !== 1)
        throw new HttpsError("invalid-argument", "Start from the first invoice page.");
      page = page.startAfter(start);
    }
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const daysAgo = (days: number) => new Date(Date.parse(`${today}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10);
    const windows = [
      { name: "Current", from: today, to: "9999-12-30" },
      { name: "1–30 days", from: daysAgo(30), to: daysAgo(1) },
      { name: "31–60 days", from: daysAgo(60), to: daysAgo(31) },
      { name: "61–90 days", from: daysAgo(90), to: daysAgo(61) },
      { name: "90+ days", from: "0001-01-01", to: daysAgo(91) },
      { name: "Due date not set", from: UNDATED_DEBT, to: UNDATED_DEBT },
    ];
    const [invoices, aging] = await Promise.all([page.limit(input.limit + 1).get(), Promise.all(windows.map(async (window) => {
      const sums = await base.where("receivableDueDate", ">=", window.from).where("receivableDueDate", "<=", window.to).aggregate({ amount: AggregateField.sum("receivableOutstandingMinor") }).get();
      return { name: window.name, amountMinor: Number(sums.data().amount ?? 0) };
    }))]);
    const visible = invoices.docs.slice(0, input.limit);
    return {
      invoices: visible.map((sale) => ({ id: sale.id, reference: sale.get("saleNumber"), accountId: sale.get("customerAccountId") ?? "general", accountName: sale.get("customerAccountName") ?? "General account", dueDate: sale.get("receivableDueDate") === UNDATED_DEBT ? null : sale.get("receivableDueDate"), outstandingMinor: sale.get("receivableOutstandingMinor"), paidMinor: sale.get("receivablePaidMinor") ?? 0, creditedMinor: sale.get("receivableCreditedMinor") ?? 0 })),
      aging, historicalUnallocatedMinor: customerArrangements(customer.data()!).reduce((sum, account) => sum + legacyDebt(account.outstandingBalanceMinor, customer.get("invoiceDebtByAccount"), account.id), 0),
      advanceBalances: moneyBalances(customer.get("advanceBalances")),
      moreAvailable: invoices.size > input.limit, nextCursor: invoices.size > input.limit ? { sale: visible.at(-1)!.id } : null,
    };
  }
  type HistorySource = "sale" | "return" | "account";
  const scoped = async (collection: string, dateField: string, source: HistorySource) => {
    let query: FirebaseFirestore.Query = db.collection(collection)
      .where("organizationId", "==", actor.organizationId)
      .where("customerId", "==", input.customerId);
    if (branchId) query = query.where("branchId", "==", branchId);
    query = query.orderBy(dateField, "desc");
    const cursorId = input.cursor?.[source];
    if (cursorId) {
      const cursor = await db.doc(`${collection}/${cursorId}`).get();
      if (!cursor.exists || cursor.get("organizationId") !== actor.organizationId || cursor.get("customerId") !== input.customerId || (branchId && cursor.get("branchId") !== branchId))
        throw new HttpsError("invalid-argument", "Customer history page is no longer available. Start from the first page.");
      query = query.startAfter(cursor);
    }
    return query.limit(input.limit + 1).get();
  };
  const [sales, returns, entries] = await Promise.all([
    scoped("sales", "recordedAt", "sale"),
    scoped("saleReturns", "createdAt", "return"),
    scoped("customerAccountEntries", "effectiveAt", "account"),
  ]);
  const date = (value: unknown) => value instanceof Timestamp ? value.toDate().toISOString() : null;
  const sortTime = (value: unknown) => value instanceof Timestamp ? value : null;
  const rows = [
    ...sales.docs.map((record) => ({
      id: `sale:${record.id}`, kind: "sale", reference: record.get("saleNumber"),
      branchId: record.get("branchId"), amountMinor: Number(record.get("grossAmountMinor") ?? 0),
      detail: String(record.get("paymentStatus") ?? "completed").replaceAll("_", " "),
      accountName: record.get("customerAccountName") ?? "General account",
      at: date(record.get("recordedAt")),
      sortAt: sortTime(record.get("recordedAt")),
    })),
    ...returns.docs.map((record) => ({
      id: `return:${record.id}`, kind: "return", reference: record.get("returnNumber"),
      branchId: record.get("branchId"), amountMinor: -Number(record.get("grossAmountMinor") ?? 0),
      detail: `${record.get("resolution") ?? "return"} · ${record.get("status") ?? "submitted"}`.replaceAll("_", " "),
      accountName: record.get("customerAccountName") ?? "General account",
      at: date(record.get("createdAt")),
      sortAt: sortTime(record.get("createdAt")),
    })),
    ...entries.docs.map((record) => ({
      id: `account:${record.id}`, kind: "account", reference: record.get("referenceNumber"),
      branchId: record.get("branchId"), amountMinor: Number(record.get("amountMinor") ?? 0),
      detail: String(record.get("entryType") ?? "account activity"),
      accountName: record.get("customerAccountName") ?? "General account",
      allocations: record.get("allocations") ?? [],
      invoiceAllocations: record.get("invoiceAllocations") ?? [],
      at: date(record.get("effectiveAt")),
      sortAt: sortTime(record.get("effectiveAt")),
    })),
  ].sort((left, right) =>
    (right.sortAt?.seconds ?? 0) - (left.sortAt?.seconds ?? 0) ||
    (right.sortAt?.nanoseconds ?? 0) - (left.sortAt?.nanoseconds ?? 0) ||
    (left.id === right.id ? 0 : left.id < right.id ? 1 : -1),
  );
  const page = rows.slice(0, input.limit);
  const moreAvailable = rows.length > input.limit || [sales, returns, entries].some((result) => result.docs.length > input.limit);
  const nextCursor = { ...input.cursor };
  for (const row of page) {
    const [source, documentId] = row.id.split(":");
    if (source === "sale" || source === "return" || source === "account") nextCursor[source] = documentId;
  }
  return {
    bankAccounts: hasServerPermission(actor, "customers.payment.record")
      ? (await db.collection("bankAccounts").where("organizationId", "==", actor.organizationId).where("active", "==", true).limit(100).get()).docs.map(bankAccountSummary)
      : [],
    customer: { id: customer.id, name: customer.get("name"), customerNumber: customer.get("customerNumber"),
      creditStatus: customer.get("creditStatus"), creditLimitMinor: Number(customer.get("creditLimitMinor") ?? 0),
      outstandingBalanceMinor: Number(customer.get("outstandingBalanceMinor") ?? 0),
      availableCreditMinor: Number(customer.get("availableCreditMinor") ?? 0), arrangements: customerArrangements(customer.data()!), advanceBalances: moneyBalances(customer.get("advanceBalances")) },
    rows: page.map((row) => ({ id: row.id, kind: row.kind, reference: row.reference, branchId: row.branchId, amountMinor: row.amountMinor, detail: row.detail, at: row.at, accountName: row.accountName, allocations: "allocations" in row ? row.allocations : [], invoiceAllocations: "invoiceAllocations" in row ? row.invoiceAllocations : [] })),
    moreAvailable,
    nextCursor: moreAvailable ? nextCursor : null,
  };
});

function clean(values: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined && value !== ""),
  );
}

export const saveCustomer = onCall({ enforceAppCheck }, async (request) => {
  const actor = await requireAccess(request);
  requirePermission(actor, "customers.manage");
  const input = parseInput(saveCustomerInput, request.data);
  const customer = input.customerId
    ? db.doc(`customers/${input.customerId}`)
    : db.collection("customers").doc();
  const counter = db.doc(`customerCounters/${actor.organizationId}`);
  const operation = db.doc(
    `idempotencyKeys/${actor.organizationId}_saveCustomer_${input.idempotencyKey}`,
  );
  const cid = correlationId();
  let result = { customerId: customer.id, customerNumber: "", saved: true };
  await db.runTransaction(async (transaction) => {
    const [current, counterSnapshot, previousOperation] = await transaction.getAll(
      customer,
      counter,
      operation,
    );
    if (previousOperation!.exists) {
      result = {
        customerId: String(previousOperation!.get("entityId")),
        customerNumber: String(previousOperation!.get("customerNumber")),
        saved: false,
      };
      return;
    }
    if (
      input.customerId &&
      (!current!.exists || current!.get("organizationId") !== actor.organizationId)
    )
      throw new HttpsError("not-found", "Customer not found.");
    if (
      current!.exists &&
      !input.active &&
      (Number(current!.get("outstandingBalanceMinor") ?? 0) > 0 || Object.values(moneyBalances(current!.get("advanceBalances"))).some((amount) => amount > 0))
    )
      throw new HttpsError(
        "failed-precondition",
        "Settle the outstanding credit balance before deactivating this customer.",
      );
    const now = FieldValue.serverTimestamp();
    let customerNumber = String(current!.get("customerNumber") ?? "");
    if (!current!.exists) {
      const sequence = Number(counterSnapshot!.get("value") ?? 0) + 1;
      customerNumber = `CUS-${String(sequence).padStart(6, "0")}`;
      transaction.set(counter, {
        organizationId: actor.organizationId,
        kind: "customer",
        value: sequence,
        updatedAt: now,
      });
    }
    const mutable = clean({
      name: input.name,
      normalizedName: input.name.toLowerCase(),
      phone: input.phone,
      email: input.email?.toLowerCase(),
      address: input.address,
      taxId: input.taxId,
      pricingTier: input.pricingTier ?? current!.get("pricingTier") ?? "retail",
      active: input.active,
      updatedAt: now,
      updatedBy: actor.userId,
    });
    if (input.arrangement) {
      if (!current!.exists) throw new HttpsError("failed-precondition", "Save the customer before adding an arrangement.");
      mutable.arrangements = upsertArrangement(current!.data()!, { id: input.arrangement.id, name: input.arrangement.name, active: input.arrangement.active });
      writeAuditLog(transaction, actor, { action: "customer.arrangement_saved", entityType: "customer", entityId: customer.id,
        correlationId: cid, sourceFunction: "saveCustomer", reason: input.arrangement.reason,
        before: { arrangements: current!.get("arrangements") ?? [] }, after: { arrangements: mutable.arrangements } });
    }
    if (current!.exists) transaction.update(customer, mutable);
    else
      transaction.create(customer, {
        organizationId: actor.organizationId,
        customerNumber,
        ...mutable,
        creditStatus: "pending",
        creditLimitMinor: 0,
        outstandingBalanceMinor: 0,
        availableCreditMinor: 0,
        createdAt: now,
        createdBy: actor.userId,
      });
    transaction.create(operation, {
      organizationId: actor.organizationId,
      action: "saveCustomer",
      entityId: customer.id,
      customerNumber,
      status: "completed",
      createdAt: now,
      createdBy: actor.userId,
    });
    writeAuditLog(transaction, actor, {
      action: `customer.${current!.exists ? "updated" : "created"}`,
      entityType: "customer",
      entityId: customer.id,
      correlationId: cid,
      sourceFunction: "saveCustomer",
      before: current!.exists
        ? { name: current!.get("name"), active: current!.get("active"), pricingTier: current!.get("pricingTier") ?? "retail" }
        : undefined,
      after: { name: input.name, active: input.active, customerNumber, pricingTier: mutable.pricingTier },
    });
    result = { customerId: customer.id, customerNumber, saved: true };
  });
  return result;
});

export const decideCustomerCredit = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "customers.credit.approve");
    if (!hasRole(actor, "system_administrator"))
      throw new HttpsError(
        "permission-denied",
        "Only a system administrator may approve customer credit.",
      );
    const input = parseInput(decideCustomerCreditInput, request.data);
    const customer = db.doc(`customers/${input.customerId}`);
    const operation = db.doc(
      `idempotencyKeys/${actor.organizationId}_decideCustomerCredit_${input.idempotencyKey}`,
    );
    const cid = correlationId();
    await db.runTransaction(async (transaction) => {
      const [current, previousOperation] = await transaction.getAll(customer, operation);
      if (previousOperation!.exists) return;
      if (!current!.exists || current!.get("organizationId") !== actor.organizationId)
        throw new HttpsError("not-found", "Customer not found.");
      if (current!.get("active") !== true && input.decision === "approve")
        throw new HttpsError("failed-precondition", "Activate the customer before approving credit.");
      const outstanding = Number(current!.get("outstandingBalanceMinor") ?? 0);
      const limit = input.decision === "approve" ? input.creditLimitMinor : 0;
      if (input.decision === "approve" && limit <= 0)
        throw new HttpsError("invalid-argument", "Approved credit requires a positive limit.");
      if (input.decision === "approve" && limit < outstanding)
        throw new HttpsError(
          "failed-precondition",
          "The credit limit cannot be below the outstanding balance.",
        );
      const status = input.decision === "approve" ? "approved" : input.decision === "suspend" ? "suspended" : "rejected";
      const now = FieldValue.serverTimestamp();
      transaction.update(customer, {
        creditStatus: status,
        creditLimitMinor: limit,
        availableCreditMinor: Math.max(0, limit - outstanding),
        creditDecisionReason: input.reason,
        creditDecidedAt: now,
        creditDecidedBy: actor.userId,
        updatedAt: now,
        updatedBy: actor.userId,
      });
      transaction.create(operation, {
        organizationId: actor.organizationId,
        action: "decideCustomerCredit",
        entityId: customer.id,
        status: "completed",
        createdAt: now,
        createdBy: actor.userId,
      });
      writeAuditLog(transaction, actor, {
        action: `customer.credit_${status}`,
        entityType: "customer",
        entityId: customer.id,
        reason: input.reason,
        correlationId: cid,
        sourceFunction: "decideCustomerCredit",
        before: {
          creditStatus: current!.get("creditStatus"),
          creditLimitMinor: current!.get("creditLimitMinor"),
        },
        after: { creditStatus: status, creditLimitMinor: limit },
      });
    });
    return { customerId: input.customerId, decision: input.decision, saved: true };
  },
);

export const recordCustomerPayment = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "customers.payment.record");
    const input = parseInput(customerPaymentInput, request.data);
    requireBranchScope(actor, input.branchId);
    const customer = db.doc(`customers/${input.customerId}`);
    const branch = db.doc(`branches/${input.branchId}`);
    const counter = db.doc(`customerPaymentCounters/${actor.organizationId}`);
    const journalCounter = db.doc(
      `journalCounters/${uniquenessDocumentId(actor.organizationId, "general")}`,
    );
    const payment = db.collection("customerPayments").doc();
    const bankAccount = db.doc(`bankAccounts/${input.bankAccountId ?? "no-bank-account"}`);
    const journal = db.collection("journalEntries").doc();
    const operation = db.doc(
      `idempotencyKeys/${actor.organizationId}_recordCustomerPayment_${input.idempotencyKey}`,
    );
    const effectiveAt = Timestamp.now();
    const accountingPeriod = accountingPeriodReference(actor.organizationId, effectiveAt);
    const cid = correlationId();
    let result = { paymentId: payment.id, paymentNumber: "", recorded: true };
    await db.runTransaction(async (transaction) => {
      const [current, branchSnapshot, counterSnapshot, journalCounterSnapshot, accountingPeriodSnapshot, previousOperation, bankAccountSnapshot] =
        await transaction.getAll(customer, branch, counter, journalCounter, accountingPeriod, operation, bankAccount);
      if (previousOperation!.exists) {
        result = {
          paymentId: String(previousOperation!.get("entityId")),
          paymentNumber: String(previousOperation!.get("paymentNumber")),
          recorded: false,
        };
        return;
      }
      assertAccountingPeriodOpen(accountingPeriodSnapshot!);
      if (!current!.exists || current!.get("organizationId") !== actor.organizationId)
        throw new HttpsError("not-found", "Customer not found.");
      if (
        !branchSnapshot!.exists ||
        branchSnapshot!.get("organizationId") !== actor.organizationId ||
        branchSnapshot!.get("status") !== "active"
      )
        throw new HttpsError("failed-precondition", "Branch is unavailable.");
      const outstanding = Number(current!.get("outstandingBalanceMinor") ?? 0);
      if (input.purpose === "advance" && current!.get("active") !== true)
        throw new HttpsError("failed-precondition", "Reactivate this customer before recording a new advance.");
      if (input.purpose === "repayment" && input.amountMinor > outstanding)
        throw new HttpsError(
          "invalid-argument",
          "The payment cannot exceed the customer's outstanding balance.",
        );
      const paymentSequence = Number(counterSnapshot!.get("value") ?? 0) + 1;
      const journalSequence = Number(journalCounterSnapshot!.get("value") ?? 0) + 1;
      const year = new Date().getUTCFullYear();
      const paymentNumber = `CRP-${year}-${String(paymentSequence).padStart(6, "0")}`;
      const journalNumber = `JRN-${year}-${String(journalSequence).padStart(6, "0")}`;
      const nextOutstanding = outstanding - (input.purpose === "repayment" ? input.amountMinor : 0);
      const allocations = (input.allocations ?? [{ accountId: "general", amountMinor: input.amountMinor }]).map((item) => ({
        ...item, accountName: selectedArrangement(current!.data()!, item.accountId, input.purpose === "repayment").name,
      }));
      const arrangements = input.purpose === "repayment" ? changeArrangementBalance(current!.data()!, allocations.map((item) => ({ accountId: item.accountId, amountMinor: -item.amountMinor }))) : current!.get("arrangements") ?? [];
      const invoicePayments: Array<{ sale: FirebaseFirestore.DocumentSnapshot; amountMinor: number; accountId: string }> = [];
      if (input.purpose === "repayment") {
        if (input.invoiceAllocations) {
          const invoices = await transaction.getAll(...input.invoiceAllocations.map((item) => db.doc(`sales/${item.saleId}`)));
          invoices.forEach((sale, index) => {
            if (!sale.exists || sale.get("organizationId") !== actor.organizationId || sale.get("customerId") !== customer.id || sale.get("receivableVersion") !== 1)
              throw new HttpsError("invalid-argument", "Select a tracked invoice belonging to this customer.");
            requireBranchScope(actor, String(sale.get("branchId")));
            invoicePayments.push({ sale, amountMinor: input.invoiceAllocations![index]!.amountMinor, accountId: sale.get("customerAccountId") ?? "general" });
          });
        }
        for (const allocation of allocations) {
          const account = selectedArrangement(current!.data()!, allocation.accountId, true);
          const legacy = legacyDebt(account.outstandingBalanceMinor, current!.get("invoiceDebtByAccount"), account.id);
          if (!input.invoiceAllocations) {
            let remaining = Math.max(0, allocation.amountMinor - legacy);
            if (remaining) {
              const invoices = await transaction.get(db.collection("sales").where("organizationId", "==", actor.organizationId).where("customerId", "==", customer.id).where("customerAccountId", "==", account.id).where("branchId", "==", input.branchId).where("receivableStatus", "==", "open").orderBy("recordedAt").limit(50));
              for (const sale of invoices.docs) {
                const amountMinor = Math.min(remaining, Number(sale.get("receivableOutstandingMinor")));
                if (amountMinor > 0) invoicePayments.push({ sale, amountMinor, accountId: account.id });
                if (invoicePayments.length > 50) throw new HttpsError("invalid-argument", "Allocate no more than 50 invoices in one receipt.");
                remaining -= amountMinor;
                if (!remaining) break;
              }
              if (remaining) throw new HttpsError("failed-precondition", "Select the invoices explicitly, choose their store, or split this receipt into smaller allocations.");
            }
          }
          const applied = invoicePayments.filter((item) => item.accountId === account.id).reduce((sum, item) => sum + item.amountMinor, 0);
          if (applied > allocation.amountMinor || allocation.amountMinor - applied > legacy)
            throw new HttpsError("invalid-argument", "Invoice allocations must match their customer arrangements; only historical debt can remain unallocated.");
        }
        if (invoicePayments.some((item) => !allocations.some((allocation) => allocation.accountId === item.accountId)))
          throw new HttpsError("invalid-argument", "Include each invoice's arrangement in the receipt allocation.");
      }
      let invoiceDebtByAccount = moneyBalances(current!.get("invoiceDebtByAccount"));
      let advanceBalances = moneyBalances(current!.get("advanceBalances"));
      for (const item of invoicePayments) {
        reduceInvoice(Number(item.sale.get("receivableOutstandingMinor")), item.amountMinor);
        invoiceDebtByAccount = changeMoneyBalance(invoiceDebtByAccount, item.accountId, -item.amountMinor);
      }
      if (input.purpose === "advance" || input.source === "advance_balance") {
        for (const allocation of allocations) advanceBalances = changeMoneyBalance(advanceBalances, allocation.accountId, input.purpose === "advance" ? allocation.amountMinor : -allocation.amountMinor);
      }
      const creditLimit = Number(current!.get("creditLimitMinor") ?? 0);
      const account = input.source === "advance_balance" ? { accountCode: "2210", accountName: "Customer advances", bankAccountId: undefined, bankName: undefined, bankAccountName: undefined, accountNumberLast4: undefined } : resolveSettlementAccount(actor.organizationId, input.method, input.bankAccountId, bankAccountSnapshot);
      const journalLines = [
        { accountCode: account.accountCode, accountName: account.accountName, debitMinor: input.amountMinor, creditMinor: 0 },
        { accountCode: input.purpose === "advance" ? "2210" : "1100", accountName: input.purpose === "advance" ? "Customer advances" : "Accounts receivable", debitMinor: 0, creditMinor: input.amountMinor },
      ];
      assertBalancedJournal(journalLines);
      const now = FieldValue.serverTimestamp();
      const invoiceAllocations = invoicePayments.map((item) => ({ saleId: item.sale.id, saleNumber: item.sale.get("saleNumber"), accountId: item.accountId, amountMinor: item.amountMinor }));
      for (const item of invoicePayments) transaction.update(item.sale.ref, { ...reduceInvoice(Number(item.sale.get("receivableOutstandingMinor")), item.amountMinor), receivablePaidMinor: Number(item.sale.get("receivablePaidMinor") ?? 0) + item.amountMinor, receivableUpdatedAt: now });
      transaction.update(customer, {
        arrangements,
        invoiceDebtByAccount,
        advanceBalances,
        outstandingBalanceMinor: nextOutstanding,
        availableCreditMinor:
          current!.get("creditStatus") === "approved"
            ? Math.max(0, creditLimit - nextOutstanding)
            : 0,
        updatedAt: now,
        updatedBy: actor.userId,
      });
      transaction.set(counter, {
        organizationId: actor.organizationId,
        kind: "customerPayment",
        value: paymentSequence,
        updatedAt: now,
      });
      transaction.set(journalCounter, {
        organizationId: actor.organizationId,
        kind: "journalEntry",
        value: journalSequence,
        updatedAt: now,
      });
      transaction.create(payment, clean({
        organizationId: actor.organizationId,
        branchId: input.branchId,
        customerId: customer.id,
        customerNumber: current!.get("customerNumber"),
        customerName: current!.get("name"),
        paymentNumber,
        method: input.source === "advance_balance" ? "customer_advance" : input.method,
        purpose: input.purpose,
        source: input.source,
        bankAccountId: account.bankAccountId,
        bankName: account.bankName,
        bankAccountName: account.bankAccountName,
        accountNumberLast4: account.accountNumberLast4,
        ledgerAccountCode: account.accountCode,
        journalEntryId: journal.id,
        amountMinor: input.amountMinor,
        allocations,
        invoiceAllocations,
        reference: input.reference,
        notes: input.notes,
        currency: "NGN",
        status: "recorded",
        recordedAt: now,
        recordedBy: actor.userId,
        createdAt: now,
      }));
      transaction.create(db.collection("customerAccountEntries").doc(), {
        organizationId: actor.organizationId,
        branchId: input.branchId,
        customerId: customer.id,
        entryType: input.purpose === "advance" ? "advance" : input.source === "advance_balance" ? "advance_applied" : "payment",
        referenceType: "customerPayment",
        referenceId: payment.id,
        referenceNumber: paymentNumber,
        amountMinor: input.purpose === "advance" ? input.amountMinor : -input.amountMinor,
        allocations,
        invoiceAllocations,
        advanceBalancesAfter: advanceBalances,
        customerAccountName: allocations.length === 1 ? allocations[0]!.accountName : "Multiple arrangements",
        balanceAfterMinor: nextOutstanding,
        currency: "NGN",
        effectiveAt,
        createdAt: now,
        createdBy: actor.userId,
      });
      transaction.create(journal, {
        organizationId: actor.organizationId,
        branchId: input.branchId,
        journalNumber,
        journalType: input.purpose === "advance" ? "customer_advance" : input.source === "advance_balance" ? "customer_advance_applied" : "customer_payment",
        status: "posted",
        referenceType: "customerPayment",
        referenceId: payment.id,
        referenceNumber: paymentNumber,
        description: `Customer payment ${paymentNumber}`,
        totalDebitMinor: input.amountMinor,
        totalCreditMinor: input.amountMinor,
        currency: "NGN",
        effectiveAt,
        postedAt: now,
        postedBy: actor.userId,
        correlationId: cid,
        createdAt: now,
      });
      for (const line of journalLines) {
        const chartAccount = db.doc(
          `chartOfAccounts/${uniquenessDocumentId(actor.organizationId, line.accountCode)}`,
        );
        transaction.set(chartAccount, {
          organizationId: actor.organizationId,
          code: line.accountCode,
          name: line.accountName,
          currency: "NGN",
          active: true,
          systemManaged: true,
          updatedAt: now,
        }, { merge: true });
        transaction.create(db.collection("journalLines").doc(), {
          organizationId: actor.organizationId,
          branchId: input.branchId,
          journalEntryId: journal.id,
          journalNumber,
          accountId: chartAccount.id,
          accountCode: line.accountCode,
          accountName: line.accountName,
          debitMinor: line.debitMinor,
          creditMinor: line.creditMinor,
          currency: "NGN",
          effectiveAt,
          createdAt: now,
        });
      }
      transaction.create(operation, {
        organizationId: actor.organizationId,
        action: "recordCustomerPayment",
        entityId: payment.id,
        paymentNumber,
        status: "completed",
        createdAt: now,
        createdBy: actor.userId,
      });
      writeAuditLog(transaction, actor, {
        action: input.purpose === "advance" ? "customer.advance_recorded" : input.source === "advance_balance" ? "customer.advance_applied" : "customer.payment_recorded",
        entityType: "customerPayment",
        entityId: payment.id,
        correlationId: cid,
        sourceFunction: "recordCustomerPayment",
        after: {
          customerId: customer.id,
          paymentNumber,
          amountMinor: input.amountMinor,
          balanceAfterMinor: nextOutstanding,
          bankAccountId: account.bankAccountId ?? null,
          ledgerAccountCode: account.accountCode,
          allocations,
          invoiceAllocations,
          purpose: input.purpose,
          source: input.source,
        },
      });
      result = { paymentId: payment.id, paymentNumber, recorded: true };
    });
    return result;
  },
);

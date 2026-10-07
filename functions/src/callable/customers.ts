import { FieldValue, Timestamp } from "firebase-admin/firestore";
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
      availableCreditMinor: Number(customer.get("availableCreditMinor") ?? 0), arrangements: customerArrangements(customer.data()!) },
    rows: page.map((row) => ({ id: row.id, kind: row.kind, reference: row.reference, branchId: row.branchId, amountMinor: row.amountMinor, detail: row.detail, at: row.at, accountName: row.accountName, allocations: "allocations" in row ? row.allocations : [] })),
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
      Number(current!.get("outstandingBalanceMinor") ?? 0) > 0
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
      if (input.amountMinor > outstanding)
        throw new HttpsError(
          "invalid-argument",
          "The payment cannot exceed the customer's outstanding balance.",
        );
      const paymentSequence = Number(counterSnapshot!.get("value") ?? 0) + 1;
      const journalSequence = Number(journalCounterSnapshot!.get("value") ?? 0) + 1;
      const year = new Date().getUTCFullYear();
      const paymentNumber = `CRP-${year}-${String(paymentSequence).padStart(6, "0")}`;
      const journalNumber = `JRN-${year}-${String(journalSequence).padStart(6, "0")}`;
      const nextOutstanding = outstanding - input.amountMinor;
      const allocations = (input.allocations ?? [{ accountId: "general", amountMinor: input.amountMinor }]).map((item) => ({
        ...item, accountName: selectedArrangement(current!.data()!, item.accountId, true).name,
      }));
      const arrangements = changeArrangementBalance(current!.data()!, allocations.map((item) => ({ accountId: item.accountId, amountMinor: -item.amountMinor })));
      const creditLimit = Number(current!.get("creditLimitMinor") ?? 0);
      const account = resolveSettlementAccount(actor.organizationId, input.method, input.bankAccountId, bankAccountSnapshot);
      const journalLines = [
        { accountCode: account.accountCode, accountName: account.accountName, debitMinor: input.amountMinor, creditMinor: 0 },
        { accountCode: "1100", accountName: "Accounts receivable", debitMinor: 0, creditMinor: input.amountMinor },
      ];
      assertBalancedJournal(journalLines);
      const now = FieldValue.serverTimestamp();
      transaction.update(customer, {
        arrangements,
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
        method: input.method,
        bankAccountId: account.bankAccountId,
        bankName: account.bankName,
        bankAccountName: account.bankAccountName,
        accountNumberLast4: account.accountNumberLast4,
        ledgerAccountCode: account.accountCode,
        journalEntryId: journal.id,
        amountMinor: input.amountMinor,
        allocations,
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
        entryType: "payment",
        referenceType: "customerPayment",
        referenceId: payment.id,
        referenceNumber: paymentNumber,
        amountMinor: -input.amountMinor,
        allocations,
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
        journalType: "customer_payment",
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
        action: "customer.payment_recorded",
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
        },
      });
      result = { paymentId: payment.id, paymentNumber, recorded: true };
    });
    return result;
  },
);

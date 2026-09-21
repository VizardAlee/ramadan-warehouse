import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import { accountingPeriodReference, assertAccountingPeriodOpen } from "../accounting/period-lock.js";
import { bankAccountSummary, resolveSettlementAccount } from "../accounting/settlement-account.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import {
  hasRole,
  requireAccess,
  requireBranchScope,
  requirePermission,
} from "../auth/authorize.js";
import { enforceAppCheck } from "../config.js";
import { uniquenessDocumentId } from "../inventory/calculations.js";
import { correlationId, parseInput } from "../utils/callable.js";
import {
  aftersalesWorkspaceInput,
  createAftersalesCaseInput,
  recordAftersalesPaymentInput,
  setAftersalesChargeInput,
  updateAftersalesCaseInput,
} from "../validation/aftersales.js";

const permittedTransitions: Record<string, string[]> = {
  open: ["diagnosed", "cancelled"],
  diagnosed: ["in_service", "awaiting_collection", "cancelled"],
  in_service: ["awaiting_collection", "cancelled"],
  awaiting_collection: ["completed"],
};

export const getAftersalesWorkspace = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "sales.returns.read");
    const input = parseInput(aftersalesWorkspaceInput, request.data);
    if (input.branchId) requireBranchScope(actor, input.branchId);
    const organizationWide = [
      "system_administrator",
      "operations_administrator",
      "finance_officer",
      "auditor",
    ].some((role) => hasRole(actor, role as Parameters<typeof hasRole>[1]));
    if (!organizationWide && !input.branchId)
      throw new HttpsError("invalid-argument", "Select an assigned store.");
    let query: FirebaseFirestore.Query = db.collection("aftersalesCases")
      .where("organizationId", "==", actor.organizationId);
    if (input.branchId) query = query.where("branchId", "==", input.branchId);
    const [cases, customers, products, bankAccounts, sales] = await Promise.all([
      query.limit(input.limit).get(),
      db.collection("customers").where("organizationId", "==", actor.organizationId).limit(500).get(),
      db.collection("products").where("organizationId", "==", actor.organizationId).limit(500).get(),
      db.collection("bankAccounts").where("organizationId", "==", actor.organizationId).where("active", "==", true).limit(100).get(),
      db.collection("sales").where("organizationId", "==", actor.organizationId).limit(200).get(),
    ]);
    return {
      cases: cases.docs
        .filter((item) => organizationWide || actor.branchIds.includes(String(item.get("branchId"))))
        .map((item) => ({ id: item.id, ...item.data() })),
      customers: customers.docs.filter((item) => item.get("active") === true).map((item) => ({ id: item.id, name: item.get("name"), customerNumber: item.get("customerNumber") })),
      products: products.docs.filter((item) => item.get("active") === true).map((item) => ({ id: item.id, name: item.get("name"), sku: item.get("sku") })),
      bankAccounts: bankAccounts.docs.map(bankAccountSummary),
      sales: sales.docs
        .filter((sale) => organizationWide || actor.branchIds.includes(String(sale.get("branchId"))))
        .map((sale) => ({ id: sale.id, saleNumber: sale.get("saleNumber"), branchId: sale.get("branchId"), customerId: sale.get("customerId") ?? null })),
    };
  },
);

export const createAftersalesCase = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "sales.returns.create");
    const input = parseInput(createAftersalesCaseInput, request.data);
    requireBranchScope(actor, input.branchId);
    const caseRef = db.collection("aftersalesCases").doc();
    const operation = db.doc(`idempotencyKeys/${actor.organizationId}_createAftersalesCase_${input.idempotencyKey}`);
    const branch = db.doc(`branches/${input.branchId}`);
    const customer = db.doc(`customers/${input.customerId}`);
    const product = db.doc(`products/${input.productId ?? "no-product"}`);
    const sale = db.doc(`sales/${input.saleId ?? "no-sale"}`);
    let result = { caseId: caseRef.id, created: true };
    await db.runTransaction(async (transaction) => {
      const [previous, branchSnapshot, customerSnapshot, productSnapshot, saleSnapshot] =
        await transaction.getAll(operation, branch, customer, product, sale);
      if (previous!.exists) {
        result = { caseId: String(previous!.get("entityId")), created: false };
        return;
      }
      if (!branchSnapshot!.exists || branchSnapshot!.get("organizationId") !== actor.organizationId || branchSnapshot!.get("status") !== "active")
        throw new HttpsError("failed-precondition", "The selected store is unavailable.");
      if (!customerSnapshot!.exists || customerSnapshot!.get("organizationId") !== actor.organizationId || customerSnapshot!.get("active") !== true)
        throw new HttpsError("failed-precondition", "Select an active customer from this organization.");
      if (input.productId && (!productSnapshot!.exists || productSnapshot!.get("organizationId") !== actor.organizationId))
        throw new HttpsError("failed-precondition", "The selected product is unavailable.");
      if (input.saleId && (!saleSnapshot!.exists || saleSnapshot!.get("organizationId") !== actor.organizationId || saleSnapshot!.get("branchId") !== input.branchId || (saleSnapshot!.get("customerId") && saleSnapshot!.get("customerId") !== input.customerId)))
        throw new HttpsError("failed-precondition", "The sale does not match this store and customer.");
      const now = FieldValue.serverTimestamp();
      transaction.create(caseRef, {
        organizationId: actor.organizationId,
        branchId: input.branchId,
        branchName: branchSnapshot!.get("name"),
        customerId: input.customerId,
        customerName: customerSnapshot!.get("name"),
        saleId: input.saleId ?? null,
        saleNumber: input.saleId ? saleSnapshot!.get("saleNumber") : null,
        productId: input.productId ?? null,
        productName: input.productId ? productSnapshot!.get("name") : null,
        serialNumber: input.serialNumber ?? null,
        serviceType: input.serviceType,
        requestType: input.requestType,
        complaint: input.complaint,
        notes: input.notes ?? null,
        status: "open",
        chargeStatus: "not_quoted",
        createdAt: now,
        createdBy: actor.userId,
        updatedAt: now,
      });
      transaction.create(operation, { organizationId: actor.organizationId, action: "createAftersalesCase", entityId: caseRef.id, status: "completed", createdAt: now, createdBy: actor.userId });
      writeAuditLog(transaction, actor, {
        action: "aftersales_case.created",
        entityType: "aftersalesCase",
        entityId: caseRef.id,
        correlationId: correlationId(),
        sourceFunction: "createAftersalesCase",
        after: { branchId: input.branchId, customerId: input.customerId, saleId: input.saleId ?? null, productId: input.productId ?? null, serviceType: input.serviceType, requestType: input.requestType, status: "open" },
      });
    });
    return result;
  },
);

export const updateAftersalesCase = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "sales.returns.approve");
    const input = parseInput(updateAftersalesCaseInput, request.data);
    const caseRef = db.doc(`aftersalesCases/${input.caseId}`);
    const operation = db.doc(`idempotencyKeys/${actor.organizationId}_updateAftersalesCase_${input.idempotencyKey}`);
    let result = { caseId: input.caseId, updated: true };
    await db.runTransaction(async (transaction) => {
      const [previous, current] = await transaction.getAll(operation, caseRef);
      if (previous!.exists) {
        result = { caseId: input.caseId, updated: false };
        return;
      }
      if (!current!.exists || current!.get("organizationId") !== actor.organizationId)
        throw new HttpsError("not-found", "Aftersales case not found.");
      requireBranchScope(actor, String(current!.get("branchId")));
      const oldStatus = String(current!.get("status"));
      if (!permittedTransitions[oldStatus]?.includes(input.status))
        throw new HttpsError("failed-precondition", "This aftersales status change is not permitted.");
      if (input.status === "completed" && current!.get("chargeStatus") === "not_quoted")
        throw new HttpsError("failed-precondition", "Set a paid charge or mark the service complimentary before closing.");
      const now = FieldValue.serverTimestamp();
      transaction.update(caseRef, {
        status: input.status,
        resolution: input.resolution,
        notes: input.notes ?? current!.get("notes") ?? null,
        updatedAt: now,
        updatedBy: actor.userId,
        ...(input.status === "completed" ? { completedAt: now } : {}),
      });
      transaction.create(operation, { organizationId: actor.organizationId, action: "updateAftersalesCase", entityId: caseRef.id, status: "completed", createdAt: now, createdBy: actor.userId });
      writeAuditLog(transaction, actor, {
        action: "aftersales_case.status_changed",
        entityType: "aftersalesCase",
        entityId: caseRef.id,
        correlationId: correlationId(),
        sourceFunction: "updateAftersalesCase",
        before: { status: oldStatus },
        after: { status: input.status, resolution: input.resolution },
      });
    });
    return result;
  },
);

export const setAftersalesCharge = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "sales.returns.approve");
    const input = parseInput(setAftersalesChargeInput, request.data);
    const caseRef = db.doc(`aftersalesCases/${input.caseId}`);
    const operation = db.doc(`idempotencyKeys/${actor.organizationId}_setAftersalesCharge_${input.idempotencyKey}`);
    let result = { caseId: input.caseId, recorded: true };
    await db.runTransaction(async (transaction) => {
      const [previous, current] = await transaction.getAll(operation, caseRef);
      if (previous!.exists) {
        result = { caseId: input.caseId, recorded: false };
        return;
      }
      if (!current!.exists || current!.get("organizationId") !== actor.organizationId)
        throw new HttpsError("not-found", "Aftersales case not found.");
      requireBranchScope(actor, String(current!.get("branchId")));
      if (["completed", "cancelled"].includes(String(current!.get("status"))) || current!.get("chargeStatus") !== "not_quoted")
        throw new HttpsError("failed-precondition", "The service charge is already set or the case is closed.");
      const now = FieldValue.serverTimestamp();
      transaction.update(caseRef, {
        chargeAmountMinor: input.chargeAmountMinor,
        amountPaidMinor: 0,
        outstandingAmountMinor: input.chargeAmountMinor,
        chargeStatus: input.chargeAmountMinor === 0 ? "complimentary" : "due",
        chargeReason: input.reason,
        chargeSetAt: now,
        chargeSetBy: actor.userId,
        updatedAt: now,
      });
      transaction.create(operation, { organizationId: actor.organizationId, action: "setAftersalesCharge", entityId: caseRef.id, status: "completed", createdAt: now, createdBy: actor.userId });
      writeAuditLog(transaction, actor, {
        action: "aftersales_case.charge_set",
        entityType: "aftersalesCase",
        entityId: caseRef.id,
        correlationId: correlationId(),
        sourceFunction: "setAftersalesCharge",
        after: { chargeAmountMinor: input.chargeAmountMinor, chargeStatus: input.chargeAmountMinor === 0 ? "complimentary" : "due", reason: input.reason },
      });
    });
    return result;
  },
);

export const recordAftersalesPayment = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "customers.payment.record");
    const input = parseInput(recordAftersalesPaymentInput, request.data);
    const caseRef = db.doc(`aftersalesCases/${input.caseId}`);
    const operation = db.doc(`idempotencyKeys/${actor.organizationId}_recordAftersalesPayment_${input.idempotencyKey}`);
    const bankAccount = db.doc(`bankAccounts/${input.bankAccountId ?? "no-bank-account"}`);
    const journalCounter = db.doc(`journalCounters/${uniquenessDocumentId(actor.organizationId, "general")}`);
    const journal = db.collection("journalEntries").doc();
    const payment = db.collection("aftersalesPayments").doc();
    const effectiveAt = Timestamp.now();
    const period = accountingPeriodReference(actor.organizationId, effectiveAt);
    let result = { paymentId: payment.id, recorded: true };
    await db.runTransaction(async (transaction) => {
      const [previous, current, accountSnapshot, counterSnapshot, periodSnapshot] =
        await transaction.getAll(operation, caseRef, bankAccount, journalCounter, period);
      if (previous!.exists) {
        result = { paymentId: String(previous!.get("entityId")), recorded: false };
        return;
      }
      assertAccountingPeriodOpen(periodSnapshot!);
      if (!current!.exists || current!.get("organizationId") !== actor.organizationId)
        throw new HttpsError("not-found", "Aftersales case not found.");
      requireBranchScope(actor, String(current!.get("branchId")));
      const outstanding = Number(current!.get("outstandingAmountMinor") ?? 0);
      if (current!.get("chargeStatus") === "not_quoted" || input.amountMinor > outstanding || outstanding <= 0 || current!.get("status") === "cancelled")
        throw new HttpsError("failed-precondition", "The service has no payable balance for this amount.");
      const settlement = resolveSettlementAccount(actor.organizationId, input.method, input.bankAccountId, accountSnapshot);
      const sequence = Number(counterSnapshot!.get("value") ?? 0) + 1;
      const journalNumber = `JRN-${effectiveAt.toDate().getUTCFullYear()}-${String(sequence).padStart(6, "0")}`;
      const now = FieldValue.serverTimestamp();
      const accountLines = [
        { code: settlement.accountCode, name: settlement.accountName, debitMinor: input.amountMinor, creditMinor: 0 },
        { code: "4100", name: "Aftersales service income", debitMinor: 0, creditMinor: input.amountMinor },
      ];
      transaction.set(journalCounter, { organizationId: actor.organizationId, kind: "journalEntry", value: sequence, updatedAt: now });
      transaction.create(journal, {
        organizationId: actor.organizationId,
        branchId: current!.get("branchId"),
        journalNumber,
        journalType: "aftersales_payment",
        status: "posted",
        referenceType: "aftersalesPayment",
        referenceId: payment.id,
        referenceNumber: caseRef.id,
        description: `Aftersales payment ${caseRef.id}`,
        totalDebitMinor: input.amountMinor,
        totalCreditMinor: input.amountMinor,
        currency: "NGN",
        effectiveAt,
        postedAt: now,
        postedBy: actor.userId,
        createdAt: now,
      });
      for (const line of accountLines) {
        const account = db.doc(`chartOfAccounts/${uniquenessDocumentId(actor.organizationId, line.code)}`);
        transaction.set(account, { organizationId: actor.organizationId, code: line.code, name: line.name, currency: "NGN", active: true, systemManaged: true, updatedAt: now }, { merge: true });
        transaction.create(db.collection("journalLines").doc(), {
          organizationId: actor.organizationId,
          branchId: current!.get("branchId"),
          journalEntryId: journal.id,
          journalNumber,
          accountId: account.id,
          accountCode: line.code,
          accountName: line.name,
          debitMinor: line.debitMinor,
          creditMinor: line.creditMinor,
          currency: "NGN",
          effectiveAt,
          createdAt: now,
        });
      }
      const nextOutstanding = outstanding - input.amountMinor;
      transaction.update(caseRef, {
        amountPaidMinor: Number(current!.get("amountPaidMinor") ?? 0) + input.amountMinor,
        outstandingAmountMinor: nextOutstanding,
        chargeStatus: nextOutstanding === 0 ? "paid" : "partially_paid",
        updatedAt: now,
      });
      transaction.create(payment, {
        organizationId: actor.organizationId,
        branchId: current!.get("branchId"),
        caseId: caseRef.id,
        customerId: current!.get("customerId"),
        method: input.method,
        amountMinor: input.amountMinor,
        reference: input.reference ?? null,
        bankAccountId: settlement.bankAccountId ?? null,
        bankName: settlement.bankName ?? null,
        accountNumberLast4: settlement.accountNumberLast4 ?? null,
        ledgerAccountCode: settlement.accountCode,
        journalEntryId: journal.id,
        currency: "NGN",
        recordedAt: now,
        recordedBy: actor.userId,
      });
      transaction.create(operation, { organizationId: actor.organizationId, action: "recordAftersalesPayment", entityId: payment.id, status: "completed", createdAt: now, createdBy: actor.userId });
      writeAuditLog(transaction, actor, {
        action: "aftersales_case.payment_recorded",
        entityType: "aftersalesCase",
        entityId: caseRef.id,
        correlationId: correlationId(),
        sourceFunction: "recordAftersalesPayment",
        after: { paymentId: payment.id, journalEntryId: journal.id, amountMinor: input.amountMinor, bankAccountId: settlement.bankAccountId ?? null, outstandingAmountMinor: nextOutstanding },
      });
    });
    return result;
  },
);

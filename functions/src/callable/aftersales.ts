import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { calculateSaleLine } from "../sales/calculations.js";
import { serviceChargeVat, serviceReceiptVat } from "../services/billing.js";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import { operationalEvidence, operationalEvidenceInput } from "../sales/operational-evidence.js";
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

const fingerprint = (input: unknown) => createHash("sha256").update(JSON.stringify(input)).digest("hex");
function checkRetry(previous: FirebaseFirestore.DocumentSnapshot, input: unknown) {
  if (previous.get("requestFingerprint") && previous.get("requestFingerprint") !== fingerprint(input))
    throw new HttpsError("invalid-argument", "This request reference belongs to different service instructions. Retry the saved original request.");
}

export const getAftersalesWorkspace = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "sales.returns.read");
    if (["list_evidence", "read_evidence", "upload_evidence"].includes(request.data?.action))
      return operationalEvidence(actor, "aftersales", parseInput(operationalEvidenceInput, request.data));
    const input = parseInput(aftersalesWorkspaceInput, request.data);
    const selectedCase = input.caseId ? await db.doc(`aftersalesCases/${input.caseId}`).get() : null;
    if (input.caseId) {
      if (!selectedCase?.exists || selectedCase.get("organizationId") !== actor.organizationId)
        throw new HttpsError("not-found", "Aftersales case not found.");
      requireBranchScope(actor, String(selectedCase.get("branchId")));
      input.branchId = String(selectedCase.get("branchId"));
    }
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
    const [cases, customers, products, bankAccounts, sales, suppliers, servicePrices] = await Promise.all([
      query.limit(input.limit).get(),
      db.collection("customers").where("organizationId", "==", actor.organizationId).limit(500).get(),
      db.collection("products").where("organizationId", "==", actor.organizationId).limit(500).get(),
      db.collection("bankAccounts").where("organizationId", "==", actor.organizationId).where("active", "==", true).limit(100).get(),
      db.collection("sales").where("organizationId", "==", actor.organizationId).limit(200).get(),
      hasServerPermission(actor, "suppliers.read") ? db.collection("suppliers").where("organizationId", "==", actor.organizationId).where("active", "==", true).limit(500).get() : null,
      db.collection("productSalesPrices").where("organizationId", "==", actor.organizationId).where("active", "==", true).limit(500).get(),
    ]);
    return {
      cases: (selectedCase ? [selectedCase] : cases.docs)
        .filter((item) => organizationWide || actor.branchIds.includes(String(item.get("branchId"))))
        .map((item) => ({ id: item.id, ...item.data() })),
      customers: customers.docs.filter((item) => item.get("active") === true).map((item) => ({ id: item.id, name: item.get("name"), customerNumber: item.get("customerNumber") })),
      products: products.docs.filter((item) => item.get("active") === true && item.get("itemKind") !== "service").map((item) => ({ id: item.id, name: item.get("name"), sku: item.get("sku") })),
      serviceItems: products.docs.filter(item => item.get("active") === true && item.get("itemKind") === "service").flatMap(item => {
        const price = servicePrices.docs.find(price => price.id === item.id || price.get("productId") === item.id);
        if (!price) return [];
        const calculation = calculateSaleLine({ quantity: 1, unitPriceMinor: Number(price.get("basePriceMinor")), vatRateBasisPoints: Number(price.get("vatRateBasisPoints")), unitCostMinor: 0 });
        return [{ id: item.id, name: item.get("name"), sku: item.get("sku"), grossAmountMinor: calculation.grossAmountMinor }];
      }),
      bankAccounts: bankAccounts.docs.map(bankAccountSummary),
      suppliers: suppliers?.docs.map(item => ({ id: item.id, name: item.get("name") })) ?? [],
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
    const serviceItem = db.doc(`products/${input.serviceItemId ?? "no-service"}`);
    const servicePrice = db.doc(`productSalesPrices/${input.serviceItemId ?? "no-service"}`);
    const sale = db.doc(`sales/${input.saleId ?? "no-sale"}`);
    let result = { caseId: caseRef.id, created: true };
    await db.runTransaction(async (transaction) => {
      const [previous, branchSnapshot, customerSnapshot, productSnapshot, saleSnapshot, serviceSnapshot, servicePriceSnapshot] =
        await transaction.getAll(operation, branch, customer, product, sale, serviceItem, servicePrice);
      if (previous!.exists) {
        checkRetry(previous!, input);
        const original = await transaction.get(db.doc(`aftersalesCases/${String(previous!.get("entityId"))}`));
        if (!original.exists || original.get("organizationId") !== actor.organizationId || original.get("branchId") !== input.branchId)
          throw new HttpsError("not-found", "Original service request not found.");
        if (!previous!.get("requestFingerprint") &&
          ["customerId", "saleId", "productId", "serviceItemId", "serialNumber", "serviceType", "requestType", "complaint", "notes"].some(field =>
            (original.get(field) ?? null) !== ((input as Record<string, unknown>)[field] ?? null)))
          throw new HttpsError("invalid-argument", "Retry the original service request without changing its details.");
        result = { caseId: String(previous!.get("entityId")), created: false };
        return;
      }
      if (!branchSnapshot!.exists || branchSnapshot!.get("organizationId") !== actor.organizationId || branchSnapshot!.get("status") !== "active")
        throw new HttpsError("failed-precondition", "The selected store is unavailable.");
      if (!customerSnapshot!.exists || customerSnapshot!.get("organizationId") !== actor.organizationId || customerSnapshot!.get("active") !== true)
        throw new HttpsError("failed-precondition", "Select an active customer from this organization.");
      if (input.productId && (!productSnapshot!.exists || productSnapshot!.get("organizationId") !== actor.organizationId || productSnapshot!.get("itemKind") === "service"))
        throw new HttpsError("failed-precondition", "The selected product is unavailable.");
      let serviceCatalog: Record<string, unknown> | null = null;
      if (input.serviceItemId) {
        if (!serviceSnapshot!.exists || serviceSnapshot!.get("organizationId") !== actor.organizationId || serviceSnapshot!.get("active") !== true || serviceSnapshot!.get("itemKind") !== "service" ||
          !servicePriceSnapshot!.exists || servicePriceSnapshot!.get("organizationId") !== actor.organizationId || servicePriceSnapshot!.get("active") !== true)
          throw new HttpsError("failed-precondition", "Select an active service with a configured catalogue price.");
        const basePriceMinor = Number(servicePriceSnapshot!.get("basePriceMinor"));
        const vatRateBasisPoints = Number(servicePriceSnapshot!.get("vatRateBasisPoints"));
        const calculation = calculateSaleLine({ quantity: 1, unitPriceMinor: basePriceMinor, vatRateBasisPoints, unitCostMinor: 0 });
        serviceCatalog = { itemId: input.serviceItemId, name: serviceSnapshot!.get("name"), sku: serviceSnapshot!.get("sku"), basePriceMinor, vatRateBasisPoints, priceVersion: servicePriceSnapshot!.get("version"), grossAmountMinor: calculation.grossAmountMinor };
      }
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
        serviceItemId: input.serviceItemId ?? null,
        serviceCatalog,
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
      transaction.create(operation, { organizationId: actor.organizationId, action: "createAftersalesCase", entityId: caseRef.id, requestFingerprint: fingerprint(input), status: "completed", createdAt: now, createdBy: actor.userId });
      writeAuditLog(transaction, actor, {
        action: "aftersales_case.created",
        entityType: "aftersalesCase",
        entityId: caseRef.id,
        correlationId: correlationId(),
        sourceFunction: "createAftersalesCase",
        after: { branchId: input.branchId, customerId: input.customerId, saleId: input.saleId ?? null, productId: input.productId ?? null, serviceCatalog, serviceType: input.serviceType, requestType: input.requestType, status: "open" },
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
      if (!current!.exists || current!.get("organizationId") !== actor.organizationId)
        throw new HttpsError("not-found", "Aftersales case not found.");
      requireBranchScope(actor, String(current!.get("branchId")));
      if (previous!.exists) {
        checkRetry(previous!, input);
        if (previous!.get("entityId") !== input.caseId || (!previous!.get("requestFingerprint") &&
          ("action" in input || current!.get("status") !== input.status || current!.get("resolution") !== input.resolution ||
            (input.notes !== undefined && current!.get("notes") !== input.notes))))
          throw new HttpsError("invalid-argument", "The original status request differs from these instructions. Review case history.");
        result = { caseId: input.caseId, updated: false };
        return;
      }
      if ("action" in input) {
        if (["completed", "cancelled"].includes(String(current!.get("status"))))
          throw new HttpsError("failed-precondition", "Closed service cases cannot be reassigned.");
        let assignedStaff: { employeeId: string; staffId: string; name: string } | null = null;
        if (input.staffId) {
          // Reuse HR's unique staff-code mapping; never create a second employee identity.
          const mapping = await transaction.get(db.doc(`employeeStaffIds/${actor.organizationId}_${encodeURIComponent(input.staffId)}`));
          const employeeId = mapping.exists && mapping.get("organizationId") === actor.organizationId ? mapping.get("employeeId") : null;
          if (typeof employeeId !== "string" || !employeeId || employeeId.includes("/") || [".", ".."].includes(employeeId))
            throw new HttpsError("failed-precondition", "Enter an active employee's HR staff ID for this store.");
          const employee = await transaction.get(db.doc(`employees/${employeeId}`));
          if (!employee.exists || employee.get("organizationId") !== actor.organizationId || employee.get("staffId") !== input.staffId ||
            employee.get("status") !== "active" || (employee.get("branchId") && employee.get("branchId") !== current!.get("branchId")) ||
            typeof employee.get("fullName") !== "string" || !employee.get("fullName").trim())
            throw new HttpsError("failed-precondition", "Enter an active employee's HR staff ID for this store.");
          assignedStaff = { employeeId, staffId: input.staffId, name: employee.get("fullName") };
        }
        const now = FieldValue.serverTimestamp();
        transaction.update(caseRef, { assignedStaff, assignmentReason: input.reason, assignedAt: now, assignedBy: actor.userId, updatedAt: now, updatedBy: actor.userId });
        transaction.create(operation, { organizationId: actor.organizationId, action: "updateAftersalesCase", entityId: caseRef.id, requestFingerprint: fingerprint(input), status: "completed", createdAt: now, createdBy: actor.userId });
        writeAuditLog(transaction, actor, {
          action: "aftersales_case.staff_assigned", entityType: "aftersalesCase", entityId: caseRef.id,
          correlationId: correlationId(), sourceFunction: "updateAftersalesCase", reason: input.reason,
          before: { assignedStaff: current!.get("assignedStaff") ?? null },
          after: { assignedStaff, branchId: current!.get("branchId"), customerName: current!.get("customerName") ?? null },
        });
        return;
      }
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
      transaction.create(operation, { organizationId: actor.organizationId, action: "updateAftersalesCase", entityId: caseRef.id, requestFingerprint: fingerprint(input), status: "completed", createdAt: now, createdBy: actor.userId });
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
      if (!current!.exists || current!.get("organizationId") !== actor.organizationId)
        throw new HttpsError("not-found", "Aftersales case not found.");
      requireBranchScope(actor, String(current!.get("branchId")));
      if (previous!.exists) {
        checkRetry(previous!, input);
        if (previous!.get("entityId") !== input.caseId || (!previous!.get("requestFingerprint") &&
          (current!.get("chargeAmountMinor") !== input.chargeAmountMinor || current!.get("chargeReason") !== input.reason)))
          throw new HttpsError("invalid-argument", "Retry the original service charge without changing its details.");
        result = { caseId: input.caseId, recorded: false };
        return;
      }
      if (["completed", "cancelled"].includes(String(current!.get("status"))) || current!.get("chargeStatus") !== "not_quoted")
        throw new HttpsError("failed-precondition", "The service charge is already set or the case is closed.");
      const now = FieldValue.serverTimestamp();
      transaction.update(caseRef, {
        chargeAmountMinor: input.chargeAmountMinor,
        ...(current!.get("serviceCatalog") ? { serviceBillingVersion: 2, chargeVatMinor: serviceChargeVat(input.chargeAmountMinor, Number(current!.get("serviceCatalog").vatRateBasisPoints)), recognizedVatMinor: 0 } : {}),
        amountPaidMinor: 0,
        outstandingAmountMinor: input.chargeAmountMinor,
        chargeStatus: input.chargeAmountMinor === 0 ? "complimentary" : "due",
        chargeReason: input.reason,
        chargeSetAt: now,
        chargeSetBy: actor.userId,
        updatedAt: now,
      });
      transaction.create(operation, { organizationId: actor.organizationId, action: "setAftersalesCharge", entityId: caseRef.id, requestFingerprint: fingerprint(input), status: "completed", createdAt: now, createdBy: actor.userId });
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
      if (!current!.exists || current!.get("organizationId") !== actor.organizationId)
        throw new HttpsError("not-found", "Aftersales case not found.");
      requireBranchScope(actor, String(current!.get("branchId")));
      if (previous!.exists) {
        checkRetry(previous!, input);
        const original = await transaction.get(db.doc(`aftersalesPayments/${String(previous!.get("entityId"))}`));
        if (!original.exists || original.get("organizationId") !== actor.organizationId || original.get("branchId") !== current!.get("branchId") ||
          original.get("caseId") !== input.caseId ||
          ["method", "amountMinor", "bankAccountId", "reference"].some(field =>
            (original.get(field) ?? null) !== (field === "bankAccountId" && input.method === "cash" ? null : (input as Record<string, unknown>)[field] ?? null)))
          throw new HttpsError("invalid-argument", "Retry the original service payment without changing its amount or account.");
        result = { paymentId: String(previous!.get("entityId")), recorded: false };
        return;
      }
      assertAccountingPeriodOpen(periodSnapshot!);
      const outstanding = Number(current!.get("outstandingAmountMinor") ?? 0);
      if (current!.get("chargeStatus") === "not_quoted" || input.amountMinor > outstanding || outstanding <= 0 || current!.get("status") === "cancelled")
        throw new HttpsError("failed-precondition", "The service has no payable balance for this amount.");
      const settlement = resolveSettlementAccount(actor.organizationId, input.method, input.bankAccountId, accountSnapshot);
      const sequence = Number(counterSnapshot!.get("value") ?? 0) + 1;
      const journalNumber = `JRN-${effectiveAt.toDate().getUTCFullYear()}-${String(sequence).padStart(6, "0")}`;
      const now = FieldValue.serverTimestamp();
      if (current!.get("serviceBillingVersion") === 2 && Number(current!.get("recognizedVatMinor")) !== serviceReceiptVat(0, Number(current!.get("amountPaidMinor") ?? 0), Number(current!.get("chargeAmountMinor")), Number(current!.get("chargeVatMinor"))))
        throw new HttpsError("failed-precondition", "Service receipt tax allocation requires reconciliation before another payment.");
      const vatMinor = current!.get("serviceBillingVersion") === 2
        ? serviceReceiptVat(Number(current!.get("amountPaidMinor") ?? 0), input.amountMinor, Number(current!.get("chargeAmountMinor")), Number(current!.get("chargeVatMinor"))) : 0;
      const accountLines = [
        { code: settlement.accountCode, name: settlement.accountName, debitMinor: input.amountMinor, creditMinor: 0 },
        { code: "4100", name: "Aftersales service income", debitMinor: 0, creditMinor: input.amountMinor - vatMinor },
        { code: "2100", name: "VAT payable", debitMinor: 0, creditMinor: vatMinor },
      ].filter(line => line.debitMinor > 0 || line.creditMinor > 0);
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
        ...(current!.get("serviceBillingVersion") === 2 ? { recognizedVatMinor: Number(current!.get("recognizedVatMinor") ?? 0) + vatMinor } : {}),
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
        ...(current!.get("serviceBillingVersion") === 2 ? { serviceBillingVersion: 2, netAmountMinor: input.amountMinor - vatMinor, vatAmountMinor: vatMinor, serviceCatalog: current!.get("serviceCatalog") } : {}),
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
      transaction.create(operation, { organizationId: actor.organizationId, action: "recordAftersalesPayment", entityId: payment.id, requestFingerprint: fingerprint(input), status: "completed", createdAt: now, createdBy: actor.userId });
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

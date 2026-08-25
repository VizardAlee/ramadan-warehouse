import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import { accountingPeriodReference, assertAccountingPeriodOpen } from "../accounting/period-lock.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import {
  hasRole,
  requireAccess,
  requireBranchScope,
  requirePermission,
  requireWarehouseScope,
} from "../auth/authorize.js";
import { enforceAppCheck } from "../config.js";
import { normalizeInventoryIdentifier, uniquenessDocumentId } from "../inventory/calculations.js";
import { assertBalancedJournal } from "../sales/calculations.js";
import { correlationId, parseInput } from "../utils/callable.js";
import {
  createExpenseInput,
  expenseActionInput,
  expenseWorkspaceInput,
  recordExpensePaymentInput,
} from "../validation/expenses.js";

const accountNames: Readonly<Record<string, string>> = {
  "1010": "Cash on hand",
  "1020": "Card clearing",
  "1030": "Bank transfer clearing",
  "1300": "Input VAT recoverable",
  "2300": "Accrued operating expenses",
  "6000": "Operating expenses",
};
const settlementAccounts: Readonly<Record<string, string>> = {
  cash: "1010",
  card: "1020",
  bank_transfer: "1030",
};

function clean(values: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== ""));
}
function year() { return new Date().getUTCFullYear(); }
function numbered(prefix: string, sequence: number) {
  return `${prefix}-${year()}-${String(sequence).padStart(6, "0")}`;
}
function organizationWide(actor: Awaited<ReturnType<typeof requireAccess>>) {
  return hasRole(actor, "system_administrator") || hasRole(actor, "operations_administrator") || hasRole(actor, "finance_officer") || hasRole(actor, "auditor");
}
function requireExpenseScope(actor: Awaited<ReturnType<typeof requireAccess>>, branchId?: string, warehouseId?: string) {
  if (branchId) requireBranchScope(actor, branchId);
  if (warehouseId) requireWarehouseScope(actor, warehouseId);
  if (!branchId && !warehouseId && !organizationWide(actor))
    throw new HttpsError("failed-precondition", "Select an assigned branch or warehouse for this expense.");
}
function expenseVisible(actor: Awaited<ReturnType<typeof requireAccess>>, data: FirebaseFirestore.DocumentData) {
  if (organizationWide(actor)) return true;
  const branchId = data.branchId ? String(data.branchId) : "";
  const warehouseId = data.warehouseId ? String(data.warehouseId) : "";
  return Boolean((branchId && actor.branchIds.includes(branchId)) || (warehouseId && actor.warehouseIds.includes(warehouseId)));
}
function writeJournal(
  transaction: FirebaseFirestore.Transaction,
  actor: Awaited<ReturnType<typeof requireAccess>>,
  values: {
    journal: FirebaseFirestore.DocumentReference;
    counter: FirebaseFirestore.DocumentReference;
    sequence: number;
    journalType: string;
    referenceType: string;
    referenceId: string;
    referenceNumber: string;
    description: string;
    branchId?: string;
    warehouseId?: string;
    effectiveAt: Timestamp;
    lines: Array<{ accountCode: string; debitMinor: number; creditMinor: number }>;
  },
) {
  assertBalancedJournal(values.lines);
  const now = FieldValue.serverTimestamp(), journalNumber = numbered("JRN", values.sequence);
  transaction.set(values.counter, { organizationId: actor.organizationId, kind: "journalEntry", value: values.sequence, updatedAt: now });
  transaction.create(values.journal, clean({
    organizationId: actor.organizationId, branchId: values.branchId, warehouseId: values.warehouseId,
    journalNumber, journalType: values.journalType, status: "posted", referenceType: values.referenceType,
    referenceId: values.referenceId, referenceNumber: values.referenceNumber, description: values.description,
    totalDebitMinor: values.lines.reduce((sum, line) => sum + line.debitMinor, 0),
    totalCreditMinor: values.lines.reduce((sum, line) => sum + line.creditMinor, 0), currency: "NGN",
    effectiveAt: values.effectiveAt, postedAt: now, postedBy: actor.userId, createdAt: now,
  }));
  values.lines.filter((line) => line.debitMinor || line.creditMinor).forEach((line) => {
    const account = db.doc(`chartOfAccounts/${uniquenessDocumentId(actor.organizationId, line.accountCode)}`);
    transaction.set(account, { organizationId: actor.organizationId, code: line.accountCode, name: accountNames[line.accountCode], currency: "NGN", active: true, systemManaged: true, updatedAt: now }, { merge: true });
    transaction.create(db.collection("journalLines").doc(), clean({
      organizationId: actor.organizationId, branchId: values.branchId, warehouseId: values.warehouseId,
      journalEntryId: values.journal.id, journalNumber, accountId: account.id, accountCode: line.accountCode,
      accountName: accountNames[line.accountCode], debitMinor: line.debitMinor, creditMinor: line.creditMinor,
      currency: "NGN", effectiveAt: values.effectiveAt, createdAt: now,
    }));
  });
}

export const getExpenseWorkspace = onCall({ enforceAppCheck }, async (request) => {
  const actor = await requireAccess(request); requirePermission(actor, "expenses.read");
  const input = parseInput(expenseWorkspaceInput, request.data); requireExpenseScope(actor, input.branchId, input.warehouseId);
  let query: FirebaseFirestore.Query = db.collection("expenses").where("organizationId", "==", actor.organizationId);
  if (input.branchId) query = query.where("branchId", "==", input.branchId);
  if (input.warehouseId) query = query.where("warehouseId", "==", input.warehouseId);
  const [categories, branches, warehouses, expenses] = await Promise.all([
    db.collection("expenseCategories").where("organizationId", "==", actor.organizationId).where("active", "==", true).limit(200).get(),
    db.collection("branches").where("organizationId", "==", actor.organizationId).where("status", "==", "active").limit(100).get(),
    db.collection("warehouses").where("organizationId", "==", actor.organizationId).where("status", "==", "active").limit(100).get(),
    query.limit(input.limit).get(),
  ]);
  return {
    categories: categories.docs.map((document) => ({ id: document.id, ...document.data() })),
    branches: branches.docs.filter((document) => organizationWide(actor) || actor.branchIds.includes(document.id)).map((document) => ({ id: document.id, name: document.get("name"), code: document.get("code") })),
    warehouses: warehouses.docs.filter((document) => organizationWide(actor) || actor.warehouseIds.includes(document.id)).map((document) => ({ id: document.id, name: document.get("name"), code: document.get("code") })),
    expenses: expenses.docs.filter((document) => expenseVisible(actor, document.data())).map((document) => ({ id: document.id, ...document.data() })),
  };
});

export const createExpense = onCall({ enforceAppCheck }, async (request) => {
  const actor = await requireAccess(request); requirePermission(actor, "expenses.create");
  const input = parseInput(createExpenseInput, request.data); requireExpenseScope(actor, input.branchId, input.warehouseId);
  const expense = db.collection("expenses").doc(), counter = db.doc(`expenseCounters/${actor.organizationId}`);
  const normalizedCategory = normalizeInventoryIdentifier(input.categoryName);
  const category = db.doc(`expenseCategories/${uniquenessDocumentId(actor.organizationId, normalizedCategory)}`);
  const categoryCounter = db.doc(`expenseCategoryCounters/${actor.organizationId}`);
  const operation = db.doc(`idempotencyKeys/${actor.organizationId}_createExpense_${input.idempotencyKey}`);
  const branch = input.branchId ? db.doc(`branches/${input.branchId}`) : null;
  const warehouse = input.warehouseId ? db.doc(`warehouses/${input.warehouseId}`) : null;
  const documentLock = input.supplierDocumentNumber
    ? db.doc(`expenseDocumentCodes/${uniquenessDocumentId(actor.organizationId, normalizeInventoryIdentifier(input.payeeName), normalizeInventoryIdentifier(input.supplierDocumentNumber))}`)
    : null;
  let result = { expenseId: expense.id, expenseNumber: "", created: true };
  await db.runTransaction(async (transaction) => {
    const refs = [operation, counter, category, categoryCounter, ...(branch ? [branch] : []), ...(warehouse ? [warehouse] : []), ...(documentLock ? [documentLock] : [])];
    const snapshots = await transaction.getAll(...refs); let cursor = 0;
    const previous = snapshots[cursor++]!, counterSnapshot = snapshots[cursor++]!, categorySnapshot = snapshots[cursor++]!, categoryCounterSnapshot = snapshots[cursor++]!;
    if (previous.exists) { result = { expenseId: String(previous.get("entityId")), expenseNumber: String(previous.get("expenseNumber")), created: false }; return; }
    const branchSnapshot = branch ? snapshots[cursor++]! : null, warehouseSnapshot = warehouse ? snapshots[cursor++]! : null, documentSnapshot = documentLock ? snapshots[cursor++]! : null;
    if (branchSnapshot && (!branchSnapshot.exists || branchSnapshot.get("organizationId") !== actor.organizationId || branchSnapshot.get("status") !== "active")) throw new HttpsError("failed-precondition", "Branch is unavailable.");
    if (warehouseSnapshot && (!warehouseSnapshot.exists || warehouseSnapshot.get("organizationId") !== actor.organizationId || warehouseSnapshot.get("status") !== "active")) throw new HttpsError("failed-precondition", "Warehouse is unavailable.");
    if (documentSnapshot?.exists) throw new HttpsError("already-exists", "This payee document number has already been recorded.");
    const sequence = Number(counterSnapshot.get("value") ?? 0) + 1, expenseNumber = numbered("EXP", sequence), now = FieldValue.serverTimestamp();
    let categoryCode = String(categorySnapshot.get("code") ?? "");
    if (!categorySnapshot.exists) {
      const categorySequence = Number(categoryCounterSnapshot.get("value") ?? 0) + 1;
      categoryCode = `EXC-${String(categorySequence).padStart(4, "0")}`;
      transaction.set(categoryCounter, { organizationId: actor.organizationId, value: categorySequence, updatedAt: now });
      transaction.create(category, { organizationId: actor.organizationId, code: categoryCode, name: input.categoryName, normalizedName: normalizedCategory, accountCode: "6000", active: true, createdAt: now, createdBy: actor.userId, updatedAt: now });
    }
    const gross = input.netAmountMinor + input.vatAmountMinor;
    transaction.set(counter, { organizationId: actor.organizationId, value: sequence, updatedAt: now });
    transaction.create(expense, clean({
      organizationId: actor.organizationId, expenseNumber, sequence, categoryId: category.id, categoryCode,
      categoryName: categorySnapshot.exists ? categorySnapshot.get("name") : input.categoryName,
      payeeName: input.payeeName, branchId: input.branchId, branchName: branchSnapshot?.get("name"),
      warehouseId: input.warehouseId, warehouseName: warehouseSnapshot?.get("name"), expenseDate: input.expenseDate,
      dueDate: input.dueDate, supplierDocumentNumber: input.supplierDocumentNumber, description: input.description,
      status: "draft", netAmountMinor: input.netAmountMinor, vatAmountMinor: input.vatAmountMinor,
      grossAmountMinor: gross, outstandingAmountMinor: gross, currency: "NGN", notes: input.notes,
      createdAt: now, createdBy: actor.userId, updatedAt: now,
    }));
    if (documentLock) transaction.create(documentLock, { organizationId: actor.organizationId, expenseId: expense.id, payeeName: input.payeeName, supplierDocumentNumber: input.supplierDocumentNumber, createdAt: now });
    transaction.create(operation, { organizationId: actor.organizationId, action: "createExpense", entityId: expense.id, expenseNumber, status: "completed", createdAt: now, createdBy: actor.userId });
    writeAuditLog(transaction, actor, { action: "expense.created", entityType: "expense", entityId: expense.id, correlationId: correlationId(), sourceFunction: "createExpense", after: clean({ expenseNumber, categoryName: input.categoryName, grossAmountMinor: gross, branchId: input.branchId, warehouseId: input.warehouseId }) });
    result = { expenseId: expense.id, expenseNumber, created: true };
  });
  return result;
});

async function expenseStatusAction(request: Parameters<typeof requireAccess>[0], action: "submit" | "approve") {
  const actor = await requireAccess(request); requirePermission(actor, action === "submit" ? "expenses.create" : "expenses.approve");
  const input = parseInput(expenseActionInput, request.data), expense = db.doc(`expenses/${input.expenseId}`);
  const initial = await expense.get();
  if (!initial.exists || initial.get("organizationId") !== actor.organizationId) throw new HttpsError("not-found", "Expense not found.");
  requireExpenseScope(actor, initial.get("branchId") || undefined, initial.get("warehouseId") || undefined);
  const operation = db.doc(`idempotencyKeys/${actor.organizationId}_${action}Expense_${input.idempotencyKey}`);
  const journalCounter = db.doc(`journalCounters/${uniquenessDocumentId(actor.organizationId, "general")}`), journal = db.collection("journalEntries").doc();
  const effectiveAt = Timestamp.fromDate(new Date(String(initial.get("expenseDate"))));
  const accountingPeriod = accountingPeriodReference(actor.organizationId, effectiveAt);
  await db.runTransaction(async (transaction) => {
    const snapshots = action === "approve" ? await transaction.getAll(operation, expense, journalCounter, accountingPeriod) : await transaction.getAll(operation, expense);
    const previous = snapshots[0]!, current = snapshots[1]!;
    if (previous.exists) return;
    const requiredStatus = action === "submit" ? "draft" : "submitted";
    if (!current.exists || current.get("status") !== requiredStatus) throw new HttpsError("failed-precondition", `Only a ${requiredStatus} expense can be ${action}ted.`);
    if (action === "approve" && current.get("createdBy") === actor.userId)
      throw new HttpsError("permission-denied", "The expense creator cannot approve their own expense.", { code: "EXPENSE_SELF_APPROVAL_FORBIDDEN" });
    if (action === "approve") assertAccountingPeriodOpen(snapshots[3]!);
    const now = FieldValue.serverTimestamp();
    if (action === "submit") {
      transaction.update(expense, { status: "submitted", submittedAt: now, submittedBy: actor.userId, updatedAt: now });
    } else {
      const journalCounterSnapshot = snapshots[2]!, net = Number(current.get("netAmountMinor")), vat = Number(current.get("vatAmountMinor"));
      const lines = [
        { accountCode: "6000", debitMinor: net, creditMinor: 0 },
        { accountCode: "1300", debitMinor: vat, creditMinor: 0 },
        { accountCode: "2300", debitMinor: 0, creditMinor: net + vat },
      ].filter((line) => line.debitMinor || line.creditMinor);
      writeJournal(transaction, actor, { journal, counter: journalCounter, sequence: Number(journalCounterSnapshot.get("value") ?? 0) + 1, journalType: "operating_expense", referenceType: "expense", referenceId: expense.id, referenceNumber: String(current.get("expenseNumber")), description: String(current.get("description")), branchId: current.get("branchId") || undefined, warehouseId: current.get("warehouseId") || undefined, effectiveAt, lines });
      transaction.update(expense, { status: "approved", approvedAt: now, approvedBy: actor.userId, approvalNotes: input.notes ?? null, journalEntryId: journal.id, updatedAt: now });
    }
    transaction.create(operation, { organizationId: actor.organizationId, action: `${action}Expense`, entityId: expense.id, status: "completed", createdAt: now, createdBy: actor.userId });
    writeAuditLog(transaction, actor, { action: `expense.${action}ted`, entityType: "expense", entityId: expense.id, correlationId: correlationId(), sourceFunction: `${action}Expense`, after: clean({ status: action === "submit" ? "submitted" : "approved", journalEntryId: action === "approve" ? journal.id : undefined }) });
  });
  return { expenseId: expense.id, status: action === "submit" ? "submitted" : "approved" };
}

export const submitExpense = onCall({ enforceAppCheck }, (request) => expenseStatusAction(request, "submit"));
export const approveExpense = onCall({ enforceAppCheck }, (request) => expenseStatusAction(request, "approve"));

export const recordExpensePayment = onCall({ enforceAppCheck }, async (request) => {
  const actor = await requireAccess(request); requirePermission(actor, "expenses.pay");
  const input = parseInput(recordExpensePaymentInput, request.data), expense = db.doc(`expenses/${input.expenseId}`);
  const initial = await expense.get();
  if (!initial.exists || initial.get("organizationId") !== actor.organizationId) throw new HttpsError("not-found", "Expense not found.");
  requireExpenseScope(actor, initial.get("branchId") || undefined, initial.get("warehouseId") || undefined);
  const operation = db.doc(`idempotencyKeys/${actor.organizationId}_recordExpensePayment_${input.idempotencyKey}`);
  const payment = db.collection("expensePayments").doc(), journalCounter = db.doc(`journalCounters/${uniquenessDocumentId(actor.organizationId, "general")}`), journal = db.collection("journalEntries").doc();
  const effectiveAt = Timestamp.fromDate(new Date(input.paidAt));
  const accountingPeriod = accountingPeriodReference(actor.organizationId, effectiveAt);
  let result = { paymentId: payment.id, recorded: true };
  await db.runTransaction(async (transaction) => {
    const [previous, current, journalCounterSnapshot, accountingPeriodSnapshot] = await transaction.getAll(operation, expense, journalCounter, accountingPeriod);
    if (previous!.exists) { result = { paymentId: String(previous!.get("entityId")), recorded: false }; return; }
    assertAccountingPeriodOpen(accountingPeriodSnapshot!);
    if (!current!.exists || !["approved", "partially_paid"].includes(String(current!.get("status")))) throw new HttpsError("failed-precondition", "Only an approved outstanding expense can be paid.");
    const outstanding = Number(current!.get("outstandingAmountMinor") ?? 0);
    if (input.amountMinor > outstanding) throw new HttpsError("failed-precondition", "Payment exceeds the expense outstanding balance.");
    const nextOutstanding = outstanding - input.amountMinor, now = FieldValue.serverTimestamp(), paymentNumber = `EPY-${payment.id.slice(0, 10).toUpperCase()}`;
    const lines = [{ accountCode: "2300", debitMinor: input.amountMinor, creditMinor: 0 }, { accountCode: settlementAccounts[input.method]!, debitMinor: 0, creditMinor: input.amountMinor }];
    writeJournal(transaction, actor, { journal, counter: journalCounter, sequence: Number(journalCounterSnapshot!.get("value") ?? 0) + 1, journalType: "expense_payment", referenceType: "expensePayment", referenceId: payment.id, referenceNumber: paymentNumber, description: `Payment for ${String(current!.get("expenseNumber"))}`, branchId: current!.get("branchId") || undefined, warehouseId: current!.get("warehouseId") || undefined, effectiveAt, lines });
    transaction.update(expense, { outstandingAmountMinor: nextOutstanding, status: nextOutstanding === 0 ? "paid" : "partially_paid", lastPaymentId: payment.id, updatedAt: now });
    transaction.create(payment, clean({ organizationId: actor.organizationId, expenseId: expense.id, expenseNumber: current!.get("expenseNumber"), paymentNumber, branchId: current!.get("branchId"), warehouseId: current!.get("warehouseId"), payeeName: current!.get("payeeName"), method: input.method, reference: input.reference, amountMinor: input.amountMinor, currency: "NGN", paidAt: effectiveAt, notes: input.notes, journalEntryId: journal.id, recordedAt: now, recordedBy: actor.userId, createdAt: now }));
    transaction.create(operation, { organizationId: actor.organizationId, action: "recordExpensePayment", entityId: payment.id, status: "completed", createdAt: now, createdBy: actor.userId });
    writeAuditLog(transaction, actor, { action: "expense.payment_recorded", entityType: "expense", entityId: expense.id, correlationId: correlationId(), sourceFunction: "recordExpensePayment", after: { paymentId: payment.id, amountMinor: input.amountMinor, method: input.method, outstandingAmountMinor: nextOutstanding } });
  });
  return result;
});

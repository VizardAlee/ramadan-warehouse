import { createHash } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import { accountingPeriodBounds, accountingPeriodReference } from "../accounting/period-lock.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import { requireAccess, requirePermission } from "../auth/authorize.js";
import { enforceAppCheck } from "../config.js";
import { uniquenessDocumentId } from "../inventory/calculations.js";
import { correlationId, parseInput } from "../utils/callable.js";
import { accountingCloseWorkspaceInput, completeAccountingCloseInput, prepareAccountingCloseInput } from "../validation/accounting-close.js";

interface Blocker { code: string; message: string; count: number }
interface TrialBalanceLine { accountCode: string; accountName: string; debitMinor: number; creditMinor: number; netMinor: number }

function dateValue(value: unknown) {
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Timestamp) return value.toDate().toISOString().slice(0, 10);
  return "";
}
function inPeriod(value: unknown, start: string, end: string) {
  const date = dateValue(value); return Boolean(date && date >= start && date <= end);
}
function evidenceHash(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

async function buildCloseEvidence(organizationId: string, periodKey: string) {
  const bounds = accountingPeriodBounds(periodKey);
  const [entriesQuery, linesQuery, accountsQuery, reconciliationsQuery, shiftsQuery, expensesQuery, invoicesQuery, returnsQuery] = await Promise.all([
    db.collection("journalEntries").where("organizationId", "==", organizationId).where("effectiveAt", ">=", bounds.start).where("effectiveAt", "<=", bounds.end).limit(2001).get(),
    db.collection("journalLines").where("organizationId", "==", organizationId).where("effectiveAt", ">=", bounds.start).where("effectiveAt", "<=", bounds.end).limit(4001).get(),
    db.collection("bankAccounts").where("organizationId", "==", organizationId).where("active", "==", true).limit(100).get(),
    db.collection("bankReconciliations").where("organizationId", "==", organizationId).limit(500).get(),
    db.collection("posShifts").where("organizationId", "==", organizationId).where("status", "==", "open").limit(501).get(),
    db.collection("expenses").where("organizationId", "==", organizationId).limit(2001).get(),
    db.collection("supplierInvoices").where("organizationId", "==", organizationId).limit(2001).get(),
    db.collection("saleReturns").where("organizationId", "==", organizationId).limit(2001).get(),
  ]);
  const blockers: Blocker[] = [];
  if (bounds.periodEnd >= new Date().toISOString().slice(0, 10)) blockers.push({ code: "PERIOD_NOT_ENDED", message: "The month must end before it can be closed.", count: 1 });
  if (entriesQuery.size > 2000 || linesQuery.size > 4000) blockers.push({ code: "PERIOD_TOO_LARGE", message: "This period exceeds the close-workspace limit and requires partitioned close support.", count: 1 });
  const entries = entriesQuery.docs.slice(0, 2000), lines = linesQuery.docs.slice(0, 4000), entryIds = new Set(entries.map((entry) => entry.id));
  const unbalancedEntries = entries.filter((entry) => Number(entry.get("totalDebitMinor") ?? 0) !== Number(entry.get("totalCreditMinor") ?? 0));
  if (unbalancedEntries.length) blockers.push({ code: "UNBALANCED_JOURNALS", message: "One or more posted journals are not balanced.", count: unbalancedEntries.length });
  const orphanLines = lines.filter((line) => !entryIds.has(String(line.get("journalEntryId"))));
  if (orphanLines.length) blockers.push({ code: "ORPHAN_JOURNAL_LINES", message: "Journal lines exist without an in-period journal header.", count: orphanLines.length });
  const lineTotalsByEntry = new Map<string, { debitMinor: number; creditMinor: number }>();
  for (const line of lines) {
    const entryId = String(line.get("journalEntryId"));
    const total = lineTotalsByEntry.get(entryId) ?? { debitMinor: 0, creditMinor: 0 };
    total.debitMinor += Number(line.get("debitMinor") ?? 0);
    total.creditMinor += Number(line.get("creditMinor") ?? 0);
    lineTotalsByEntry.set(entryId, total);
  }
  const lineTotalMismatches = entries.filter((entry) => {
    const total = lineTotalsByEntry.get(entry.id) ?? { debitMinor: 0, creditMinor: 0 };
    return total.debitMinor !== Number(entry.get("totalDebitMinor") ?? 0) || total.creditMinor !== Number(entry.get("totalCreditMinor") ?? 0);
  });
  if (lineTotalMismatches.length) blockers.push({ code: "JOURNAL_LINE_TOTAL_MISMATCH", message: "One or more journal headers do not equal the sum of their journal lines.", count: lineTotalMismatches.length });
  const grouped = new Map<string, TrialBalanceLine>();
  for (const line of lines) {
    const accountCode = String(line.get("accountCode") ?? "UNKNOWN"), debitMinor = Number(line.get("debitMinor") ?? 0), creditMinor = Number(line.get("creditMinor") ?? 0);
    const current = grouped.get(accountCode) ?? { accountCode, accountName: String(line.get("accountName") ?? accountCode), debitMinor: 0, creditMinor: 0, netMinor: 0 };
    current.debitMinor += debitMinor; current.creditMinor += creditMinor; current.netMinor = current.debitMinor - current.creditMinor; grouped.set(accountCode, current);
  }
  const trialBalance = [...grouped.values()].sort((a, b) => a.accountCode.localeCompare(b.accountCode));
  const totalDebitMinor = trialBalance.reduce((sum, line) => sum + line.debitMinor, 0), totalCreditMinor = trialBalance.reduce((sum, line) => sum + line.creditMinor, 0);
  if (totalDebitMinor !== totalCreditMinor) blockers.push({ code: "TRIAL_BALANCE_DIFFERENCE", message: "The trial balance does not net to zero.", count: Math.abs(totalDebitMinor - totalCreditMinor) });
  const closedBankAccounts = new Set(reconciliationsQuery.docs.filter((document) => document.get("status") === "closed" && document.get("periodStart") === bounds.periodStart && document.get("periodEnd") === bounds.periodEnd).map((document) => String(document.get("bankAccountId"))));
  const unreconciledAccounts = accountsQuery.docs.filter((account) => !closedBankAccounts.has(account.id));
  if (unreconciledAccounts.length) blockers.push({ code: "BANK_RECONCILIATION_REQUIRED", message: "Every active bank account needs a closed reconciliation for this exact month.", count: unreconciledAccounts.length });
  const openShifts = shiftsQuery.docs.filter((shift) => dateValue(shift.get("openedAt")) <= bounds.periodEnd);
  if (openShifts.length) blockers.push({ code: "OPEN_POS_SHIFTS", message: "Close all POS shifts opened on or before the period end.", count: openShifts.length });
  const pendingExpenses = expensesQuery.docs.filter((expense) => ["draft", "submitted"].includes(String(expense.get("status"))) && inPeriod(expense.get("expenseDate"), bounds.periodStart, bounds.periodEnd));
  if (pendingExpenses.length) blockers.push({ code: "PENDING_EXPENSES", message: "Resolve draft or submitted expenses dated in this month.", count: pendingExpenses.length });
  const pendingInvoices = invoicesQuery.docs.filter((invoice) => ["draft", "submitted"].includes(String(invoice.get("status"))) && inPeriod(invoice.get("invoiceDate"), bounds.periodStart, bounds.periodEnd));
  if (pendingInvoices.length) blockers.push({ code: "PENDING_SUPPLIER_INVOICES", message: "Resolve draft or submitted supplier invoices dated in this month.", count: pendingInvoices.length });
  const pendingReturns = returnsQuery.docs.filter((saleReturn) => saleReturn.get("status") === "submitted" && inPeriod(saleReturn.get("createdAt"), bounds.periodStart, bounds.periodEnd));
  if (pendingReturns.length) blockers.push({ code: "PENDING_SALE_RETURNS", message: "Resolve submitted sale returns created in this month.", count: pendingReturns.length });
  return { periodKey, ...bounds, journalEntryCount: entries.length, journalLineCount: lines.length, totalDebitMinor, totalCreditMinor, trialBalance, blockers };
}

export const getAccountingCloseWorkspace = onCall({ enforceAppCheck, timeoutSeconds: 120 }, async (request) => {
  const actor = await requireAccess(request); requirePermission(actor, "accounting.close.read");
  const input = parseInput(accountingCloseWorkspaceInput, request.data), evidence = await buildCloseEvidence(actor.organizationId, input.periodKey);
  const periods = await db.collection("accountingPeriods").where("organizationId", "==", actor.organizationId).limit(120).get();
  const history: Array<{ id: string; [key: string]: unknown }> = periods.docs.map((document) => ({
    id: document.id,
    ...document.data(),
  }));
  return {
    evidence,
    periods: history.sort((a, b) => String(b.periodKey).localeCompare(String(a.periodKey))),
  };
});

export const prepareAccountingPeriodClose = onCall({ enforceAppCheck, timeoutSeconds: 120 }, async (request) => {
  const actor = await requireAccess(request); requirePermission(actor, "accounting.close.prepare");
  const input = parseInput(prepareAccountingCloseInput, request.data), period = accountingPeriodReference(actor.organizationId, `${input.periodKey}-01`), operation = db.doc(`idempotencyOperations/${uniquenessDocumentId(actor.organizationId, "prepareAccountingPeriodClose", input.idempotencyKey)}`);
  const existingOperation = await operation.get();
  if (existingOperation.exists) return { accountingPeriodId: String(existingOperation.get("entityId")), status: "prepared", prepared: false };
  await db.runTransaction(async (transaction) => {
    const [current, previous] = await transaction.getAll(period, operation) as [FirebaseFirestore.DocumentSnapshot, FirebaseFirestore.DocumentSnapshot];
    if (previous.exists) return;
    if (current.exists && ["prepared", "closed"].includes(String(current.get("status")))) throw new HttpsError("failed-precondition", "This accounting period is already prepared or closed.");
    if (current.exists && current.get("status") === "preparing" && current.get("preparationKey") !== input.idempotencyKey) throw new HttpsError("aborted", "Another close preparation is in progress.");
    const bounds = accountingPeriodBounds(input.periodKey), now = FieldValue.serverTimestamp();
    transaction.set(period, { organizationId: actor.organizationId, periodKey: input.periodKey, periodStart: bounds.periodStart, periodEnd: bounds.periodEnd, status: "preparing", preparationKey: input.idempotencyKey, preparedBy: actor.userId, preparationNotes: input.notes ?? null, updatedAt: now, createdAt: current.exists ? current.get("createdAt") : now }, { merge: true });
  });
  let evidence: Awaited<ReturnType<typeof buildCloseEvidence>>;
  try {
    evidence = await buildCloseEvidence(actor.organizationId, input.periodKey);
  } catch (error) {
    await period.update({
      status: "open",
      preparationKey: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    throw error;
  }
  if (evidence.blockers.length) {
    await period.update({ status: "open", blockers: evidence.blockers, preparationKey: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
    throw new HttpsError("failed-precondition", "Resolve every accounting close blocker before preparation.", { code: "ACCOUNTING_CLOSE_BLOCKED", blockers: evidence.blockers });
  }
  await db.runTransaction(async (transaction) => {
    const [current, previous] = await transaction.getAll(period, operation) as [FirebaseFirestore.DocumentSnapshot, FirebaseFirestore.DocumentSnapshot];
    if (previous.exists) return;
    if (!current.exists || current.get("status") !== "preparing" || current.get("preparationKey") !== input.idempotencyKey || current.get("preparedBy") !== actor.userId) throw new HttpsError("aborted", "The accounting close preparation changed. Refresh and try again.");
    const now = FieldValue.serverTimestamp(), snapshotHash = evidenceHash({ trialBalance: evidence.trialBalance, journalEntryCount: evidence.journalEntryCount, journalLineCount: evidence.journalLineCount, totalDebitMinor: evidence.totalDebitMinor, totalCreditMinor: evidence.totalCreditMinor });
    transaction.update(period, { status: "prepared", journalEntryCount: evidence.journalEntryCount, journalLineCount: evidence.journalLineCount, totalDebitMinor: evidence.totalDebitMinor, totalCreditMinor: evidence.totalCreditMinor, trialBalance: evidence.trialBalance, blockerCount: 0, blockers: [], snapshotHash, preparedAt: now, updatedAt: now });
    transaction.create(operation, { organizationId: actor.organizationId, action: "prepareAccountingPeriodClose", entityId: period.id, periodKey: input.periodKey, status: "completed", createdAt: now, createdBy: actor.userId });
    writeAuditLog(transaction, actor, { action: "accounting_period.prepared", entityType: "accountingPeriod", entityId: period.id, correlationId: correlationId(), sourceFunction: "prepareAccountingPeriodClose", after: { periodKey: input.periodKey, snapshotHash, totalDebitMinor: evidence.totalDebitMinor, totalCreditMinor: evidence.totalCreditMinor } });
  });
  return { accountingPeriodId: period.id, status: "prepared", prepared: true };
});

export const completeAccountingPeriodClose = onCall({ enforceAppCheck, timeoutSeconds: 120 }, async (request) => {
  const actor = await requireAccess(request); requirePermission(actor, "accounting.close.approve");
  const input = parseInput(completeAccountingCloseInput, request.data), period = db.doc(`accountingPeriods/${input.accountingPeriodId}`), operation = db.doc(`idempotencyOperations/${uniquenessDocumentId(actor.organizationId, "completeAccountingPeriodClose", input.idempotencyKey)}`);
  const [current, existingOperation] = await db.getAll(period, operation) as [FirebaseFirestore.DocumentSnapshot, FirebaseFirestore.DocumentSnapshot];
  if (existingOperation.exists) return { accountingPeriodId: period.id, status: "closed" };
  if (!current.exists || current.get("organizationId") !== actor.organizationId) throw new HttpsError("not-found", "Accounting period not found.");
  if (current.get("status") !== "prepared") throw new HttpsError("failed-precondition", "Only a prepared accounting period can be completed.");
  if (current.get("preparedBy") === actor.userId) throw new HttpsError("permission-denied", "The close preparer cannot complete their own accounting period.", { code: "ACCOUNTING_CLOSE_SELF_APPROVAL_FORBIDDEN" });
  const evidence = await buildCloseEvidence(actor.organizationId, String(current.get("periodKey")));
  if (evidence.blockers.length) throw new HttpsError("failed-precondition", "Accounting close blockers appeared after preparation.", { code: "ACCOUNTING_CLOSE_BLOCKED", blockers: evidence.blockers });
  const snapshotHash = evidenceHash({ trialBalance: evidence.trialBalance, journalEntryCount: evidence.journalEntryCount, journalLineCount: evidence.journalLineCount, totalDebitMinor: evidence.totalDebitMinor, totalCreditMinor: evidence.totalCreditMinor });
  if (snapshotHash !== current.get("snapshotHash")) throw new HttpsError("aborted", "The accounting evidence changed after preparation.");
  await db.runTransaction(async (transaction) => {
    const [latest, previous] = await transaction.getAll(period, operation) as [FirebaseFirestore.DocumentSnapshot, FirebaseFirestore.DocumentSnapshot];
    if (previous.exists) return;
    if (latest.get("status") !== "prepared" || latest.get("preparedBy") === actor.userId || latest.get("snapshotHash") !== snapshotHash) throw new HttpsError("aborted", "The accounting period is no longer eligible for independent completion.");
    const now = FieldValue.serverTimestamp();
    transaction.update(period, { status: "closed", completionNotes: input.notes ?? null, closedAt: now, closedBy: actor.userId, updatedAt: now });
    transaction.create(operation, { organizationId: actor.organizationId, action: "completeAccountingPeriodClose", entityId: period.id, status: "completed", createdAt: now, createdBy: actor.userId });
    writeAuditLog(transaction, actor, { action: "accounting_period.closed", entityType: "accountingPeriod", entityId: period.id, correlationId: correlationId(), sourceFunction: "completeAccountingPeriodClose", after: { periodKey: latest.get("periodKey"), snapshotHash } });
  });
  return { accountingPeriodId: period.id, status: "closed" };
});

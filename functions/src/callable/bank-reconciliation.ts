import { createHash } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import { requireAccess, requirePermission } from "../auth/authorize.js";
import { enforceAppCheck } from "../config.js";
import { uniquenessDocumentId } from "../inventory/calculations.js";
import { correlationId, parseInput } from "../utils/callable.js";
import {
  bankMatchInput,
  bankUnmatchInput,
  bankWorkspaceInput,
  completeBankReconciliationInput,
  importBankStatementInput,
  prepareBankReconciliationInput,
  saveBankAccountInput,
} from "../validation/bank-reconciliation.js";

function dateTimestamp(value: string) {
  return Timestamp.fromDate(new Date(`${value}T00:00:00.000Z`));
}
function dateValue(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Timestamp) return value.toDate().toISOString().slice(0, 10);
  return "";
}
function year() { return new Date().getUTCFullYear(); }
function numbered(sequence: number) { return `BRC-${year()}-${String(sequence).padStart(6, "0")}`; }
function statementFingerprint(bankAccountId: string, row: { transactionDate: string; description: string; reference?: string; externalId?: string; amountMinor: number }) {
  const identity = row.externalId ? [bankAccountId, "external", row.externalId] : [
    bankAccountId,
    "derived",
    row.transactionDate,
    row.amountMinor,
    row.reference ?? "",
    row.description.toLowerCase(),
  ];
  return createHash("sha256").update(identity.join("|")).digest("hex");
}
function statementMovement(snapshot: FirebaseFirestore.DocumentSnapshot) {
  return Number(snapshot.get("amountMinor") ?? 0);
}
function ledgerMovement(snapshot: FirebaseFirestore.DocumentSnapshot) {
  return Number(snapshot.get("debitMinor") ?? 0) - Number(snapshot.get("creditMinor") ?? 0);
}
function expectedLineAmount(statement: FirebaseFirestore.DocumentSnapshot) {
  const amount = statementMovement(statement);
  return amount > 0 ? { debitMinor: amount, creditMinor: 0 } : { debitMinor: 0, creditMinor: Math.abs(amount) };
}
function assertMatch(statement: FirebaseFirestore.DocumentSnapshot, line: FirebaseFirestore.DocumentSnapshot, accountCode: string) {
  const expected = expectedLineAmount(statement);
  if (String(line.get("accountCode")) !== accountCode || Number(line.get("debitMinor") ?? 0) !== expected.debitMinor || Number(line.get("creditMinor") ?? 0) !== expected.creditMinor)
    throw new HttpsError("failed-precondition", "The selected ledger line does not equal the statement transaction.");
  const statementDate = new Date(`${dateValue(statement.get("transactionDate"))}T00:00:00.000Z`).getTime();
  const journalDate = new Date(`${dateValue(line.get("effectiveAt"))}T00:00:00.000Z`).getTime();
  if (!Number.isFinite(statementDate) || !Number.isFinite(journalDate) || Math.abs(statementDate - journalDate) > 31 * 86_400_000)
    throw new HttpsError("failed-precondition", "The statement and ledger dates are more than 31 days apart.");
}
function clean(values: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== ""));
}

export const getBankReconciliationWorkspace = onCall({ enforceAppCheck }, async (request) => {
  const actor = await requireAccess(request); requirePermission(actor, "banking.read");
  const input = parseInput(bankWorkspaceInput, request.data ?? {});
  const accountsSnapshot = await db.collection("bankAccounts").where("organizationId", "==", actor.organizationId).get();
  const accounts = accountsSnapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
  if (!input.bankAccountId) return { accounts, statementTransactions: [], journalLines: [], reconciliations: [] };
  const account = accountsSnapshot.docs.find((document) => document.id === input.bankAccountId);
  if (!account) throw new HttpsError("not-found", "Bank account not found.");
  const [statements, lines, reconciliations] = await Promise.all([
    db.collection("bankStatementTransactions").where("organizationId", "==", actor.organizationId).where("bankAccountId", "==", account.id).limit(500).get(),
    db.collection("journalLines").where("organizationId", "==", actor.organizationId).where("accountCode", "==", String(account.get("ledgerAccountCode"))).limit(500).get(),
    db.collection("bankReconciliations").where("organizationId", "==", actor.organizationId).where("bankAccountId", "==", account.id).limit(100).get(),
  ]);
  return {
    accounts,
    statementTransactions: statements.docs.sort((a, b) => String(b.get("transactionDate")).localeCompare(String(a.get("transactionDate")))).map((document) => ({ id: document.id, ...document.data() })),
    journalLines: lines.docs.sort((a, b) => dateValue(b.get("effectiveAt")).localeCompare(dateValue(a.get("effectiveAt")))).map((document) => ({ id: document.id, ...document.data() })),
    reconciliations: reconciliations.docs.sort((a, b) => String(b.get("periodEnd")).localeCompare(String(a.get("periodEnd")))).map((document) => ({ id: document.id, ...document.data() })),
  };
});

export const saveBankAccount = onCall({ enforceAppCheck }, async (request) => {
  const actor = await requireAccess(request); requirePermission(actor, "banking.manage");
  const input = parseInput(saveBankAccountInput, request.data);
  const account = input.bankAccountId ? db.doc(`bankAccounts/${input.bankAccountId}`) : db.collection("bankAccounts").doc();
  const uniqueness = db.doc(`uniquenessLocks/${uniquenessDocumentId(actor.organizationId, "bank-ledger", input.ledgerAccountCode)}`);
  await db.runTransaction(async (transaction) => {
    const [current, lock] = await transaction.getAll(account, uniqueness) as [FirebaseFirestore.DocumentSnapshot, FirebaseFirestore.DocumentSnapshot];
    if (current.exists && current.get("organizationId") !== actor.organizationId) throw new HttpsError("not-found", "Bank account not found.");
    if (current.exists && current.get("ledgerAccountCode") !== input.ledgerAccountCode) throw new HttpsError("failed-precondition", "A bank account's ledger code cannot be changed.");
    if (!current.exists && lock.exists) throw new HttpsError("already-exists", "That bank ledger code is already assigned to another account.");
    const now = FieldValue.serverTimestamp();
    transaction.set(account, clean({ organizationId: actor.organizationId, bankName: input.bankName, accountName: input.accountName, accountNumberLast4: input.accountNumberLast4, ledgerAccountCode: input.ledgerAccountCode, openingBalanceMinor: input.openingBalanceMinor, openingDate: input.openingDate, currency: "NGN", active: input.active, createdAt: current.exists ? current.get("createdAt") : now, createdBy: current.exists ? current.get("createdBy") : actor.userId, updatedAt: now, updatedBy: actor.userId }));
    if (!current.exists) transaction.create(uniqueness, { organizationId: actor.organizationId, entityType: "bankAccount", entityId: account.id, createdAt: now });
    writeAuditLog(transaction, actor, { action: current.exists ? "bank_account.updated" : "bank_account.created", entityType: "bankAccount", entityId: account.id, correlationId: correlationId(), sourceFunction: "saveBankAccount", after: { bankName: input.bankName, accountNumberLast4: input.accountNumberLast4, ledgerAccountCode: input.ledgerAccountCode } });
  });
  return { bankAccountId: account.id };
});

export const importBankStatement = onCall({ enforceAppCheck }, async (request) => {
  const actor = await requireAccess(request); requirePermission(actor, "banking.reconcile");
  const input = parseInput(importBankStatementInput, request.data);
  const account = await db.doc(`bankAccounts/${input.bankAccountId}`).get();
  if (!account.exists || account.get("organizationId") !== actor.organizationId || account.get("active") !== true) throw new HttpsError("failed-precondition", "Select an active bank account.");
  const operation = db.doc(`idempotencyOperations/${uniquenessDocumentId(actor.organizationId, "importBankStatement", input.idempotencyKey)}`);
  const previous = await operation.get();
  if (previous.exists) return { importedCount: Number(previous.get("importedCount") ?? 0), duplicateCount: Number(previous.get("duplicateCount") ?? 0), imported: false };
  const references = input.rows.map((row) => db.doc(`bankStatementTransactions/${uniquenessDocumentId(actor.organizationId, statementFingerprint(input.bankAccountId, row))}`));
  const existing = await db.getAll(...references), batch = db.batch();
  let importedCount = 0, duplicateCount = 0;
  const seen = new Set<string>();
  input.rows.forEach((row, index) => {
    if (existing[index]!.exists || seen.has(references[index]!.id)) { duplicateCount += 1; return; }
    seen.add(references[index]!.id);
    importedCount += 1;
    batch.create(references[index]!, clean({ organizationId: actor.organizationId, bankAccountId: input.bankAccountId, transactionDate: row.transactionDate, description: row.description, reference: row.reference, externalId: row.externalId, fingerprint: statementFingerprint(input.bankAccountId, row), amountMinor: row.amountMinor, currency: "NGN", status: "unmatched", importedAt: FieldValue.serverTimestamp(), importedBy: actor.userId, createdAt: FieldValue.serverTimestamp() }));
  });
  batch.create(operation, { organizationId: actor.organizationId, action: "importBankStatement", importedCount, duplicateCount, status: "completed", createdAt: FieldValue.serverTimestamp(), createdBy: actor.userId });
  batch.create(db.collection("auditLogs").doc(), { organizationId: actor.organizationId, actorUserId: actor.userId, actorRoleId: actor.roleId, actorRoleIds: actor.roleIds ?? [actor.roleId], action: "bank_statement.imported", entityType: "bankAccount", entityId: input.bankAccountId, correlationId: correlationId(), sourceFunction: "importBankStatement", after: { importedCount, duplicateCount }, createdAt: FieldValue.serverTimestamp() });
  await batch.commit();
  return { importedCount, duplicateCount, imported: true };
});

export const matchBankTransaction = onCall({ enforceAppCheck }, async (request) => {
  const actor = await requireAccess(request); requirePermission(actor, "banking.reconcile");
  const input = parseInput(bankMatchInput, request.data), statement = db.doc(`bankStatementTransactions/${input.statementTransactionId}`), line = db.doc(`journalLines/${input.journalLineId}`);
  const operation = db.doc(`idempotencyOperations/${uniquenessDocumentId(actor.organizationId, "matchBankTransaction", input.idempotencyKey)}`);
  await db.runTransaction(async (transaction) => {
    const [currentStatement, currentLine, previous] = await transaction.getAll(statement, line, operation) as [FirebaseFirestore.DocumentSnapshot, FirebaseFirestore.DocumentSnapshot, FirebaseFirestore.DocumentSnapshot];
    if (previous.exists) return;
    if (!currentStatement.exists || currentStatement.get("organizationId") !== actor.organizationId || !currentLine.exists || currentLine.get("organizationId") !== actor.organizationId) throw new HttpsError("not-found", "Statement transaction or ledger line not found.");
    if (currentStatement.get("status") !== "unmatched" || currentLine.get("bankStatementTransactionId")) throw new HttpsError("failed-precondition", "The statement transaction or ledger line is already matched.");
    const account = await transaction.get(db.doc(`bankAccounts/${String(currentStatement.get("bankAccountId"))}`));
    if (!account.exists || account.get("organizationId") !== actor.organizationId) throw new HttpsError("not-found", "Bank account not found.");
    assertMatch(currentStatement, currentLine, String(account.get("ledgerAccountCode")));
    const now = FieldValue.serverTimestamp();
    transaction.update(statement, { status: "matched", journalLineId: line.id, journalEntryId: currentLine.get("journalEntryId") ?? null, journalNumber: currentLine.get("journalNumber") ?? null, matchedAt: now, matchedBy: actor.userId, updatedAt: now });
    transaction.update(line, { bankAccountId: account.id, bankStatementTransactionId: statement.id, bankMatchedAt: now, bankMatchedBy: actor.userId });
    transaction.create(operation, { organizationId: actor.organizationId, action: "matchBankTransaction", entityId: statement.id, status: "completed", createdAt: now, createdBy: actor.userId });
    writeAuditLog(transaction, actor, { action: "bank_transaction.matched", entityType: "bankStatementTransaction", entityId: statement.id, correlationId: correlationId(), sourceFunction: "matchBankTransaction", after: { journalLineId: line.id } });
  });
  return { statementTransactionId: statement.id, status: "matched" };
});

export const unmatchBankTransaction = onCall({ enforceAppCheck }, async (request) => {
  const actor = await requireAccess(request); requirePermission(actor, "banking.reconcile");
  const input = parseInput(bankUnmatchInput, request.data), statement = db.doc(`bankStatementTransactions/${input.statementTransactionId}`);
  const operation = db.doc(`idempotencyOperations/${uniquenessDocumentId(actor.organizationId, "unmatchBankTransaction", input.idempotencyKey)}`);
  await db.runTransaction(async (transaction) => {
    const [current, previous] = await transaction.getAll(statement, operation) as [FirebaseFirestore.DocumentSnapshot, FirebaseFirestore.DocumentSnapshot];
    if (previous.exists) return;
    if (!current.exists || current.get("organizationId") !== actor.organizationId) throw new HttpsError("not-found", "Statement transaction not found.");
    if (current.get("status") !== "matched" || current.get("reconciliationId")) throw new HttpsError("failed-precondition", "Only an open matched transaction may be unmatched.");
    const line = db.doc(`journalLines/${String(current.get("journalLineId"))}`), lineSnapshot = await transaction.get(line);
    if (!lineSnapshot.exists || lineSnapshot.get("bankStatementTransactionId") !== statement.id) throw new HttpsError("failed-precondition", "The ledger match is no longer consistent.");
    const remove = { bankAccountId: FieldValue.delete(), bankStatementTransactionId: FieldValue.delete(), bankMatchedAt: FieldValue.delete(), bankMatchedBy: FieldValue.delete() }, now = FieldValue.serverTimestamp();
    transaction.update(line, remove);
    transaction.update(statement, { status: "unmatched", journalLineId: FieldValue.delete(), journalEntryId: FieldValue.delete(), journalNumber: FieldValue.delete(), matchedAt: FieldValue.delete(), matchedBy: FieldValue.delete(), updatedAt: now });
    transaction.create(operation, { organizationId: actor.organizationId, action: "unmatchBankTransaction", entityId: statement.id, status: "completed", createdAt: now, createdBy: actor.userId });
    writeAuditLog(transaction, actor, { action: "bank_transaction.unmatched", entityType: "bankStatementTransaction", entityId: statement.id, correlationId: correlationId(), sourceFunction: "unmatchBankTransaction", after: { status: "unmatched" } });
  });
  return { statementTransactionId: statement.id, status: "unmatched" };
});

async function periodEvidence(organizationId: string, bankAccountId: string, periodStart: string, periodEnd: string) {
  const account = await db.doc(`bankAccounts/${bankAccountId}`).get();
  if (!account.exists || account.get("organizationId") !== organizationId || account.get("active") !== true) throw new HttpsError("failed-precondition", "Select an active bank account.");
  const [statementQuery, lineQuery, reconciliationQuery] = await Promise.all([
    db.collection("bankStatementTransactions").where("organizationId", "==", organizationId).where("bankAccountId", "==", bankAccountId).where("transactionDate", ">=", periodStart).where("transactionDate", "<=", periodEnd).limit(201).get(),
    db.collection("journalLines").where("organizationId", "==", organizationId).where("accountCode", "==", String(account.get("ledgerAccountCode"))).where("effectiveAt", ">=", dateTimestamp(periodStart)).where("effectiveAt", "<=", Timestamp.fromDate(new Date(`${periodEnd}T23:59:59.999Z`))).limit(201).get(),
    db.collection("bankReconciliations").where("organizationId", "==", organizationId).where("bankAccountId", "==", bankAccountId).limit(100).get(),
  ]);
  const statements = statementQuery.docs;
  const lines = lineQuery.docs;
  if (statements.length > 200 || lines.length > 200) throw new HttpsError("resource-exhausted", "Reconcile a shorter period containing at most 200 statement and ledger rows.");
  const overlap = reconciliationQuery.docs.some((document) => document.get("status") === "closed" && String(document.get("periodStart")) <= periodEnd && String(document.get("periodEnd")) >= periodStart);
  if (overlap) throw new HttpsError("failed-precondition", "This period overlaps a closed bank reconciliation.");
  if (statements.length === 0 && lines.length === 0) throw new HttpsError("failed-precondition", "There are no statement or ledger transactions in this period.");
  const statementIds = new Set(statements.map((document) => document.id)), lineIds = new Set(lines.map((document) => document.id));
  if (statements.some((document) => document.get("status") !== "matched" || !lineIds.has(String(document.get("journalLineId"))))) throw new HttpsError("failed-precondition", "Match every statement transaction in the period before preparing reconciliation.");
  if (lines.some((document) => !statementIds.has(String(document.get("bankStatementTransactionId"))))) throw new HttpsError("failed-precondition", "Match every bank-ledger line in the period before preparing reconciliation.");
  const statementMovementMinor = statements.reduce((sum, document) => sum + statementMovement(document), 0), ledgerMovementMinor = lines.reduce((sum, document) => sum + ledgerMovement(document), 0);
  if (statementMovementMinor !== ledgerMovementMinor) throw new HttpsError("failed-precondition", "Statement and bank-ledger movements do not agree.");
  return { account, statements, lines, statementMovementMinor, ledgerMovementMinor };
}

export const prepareBankReconciliation = onCall({ enforceAppCheck, timeoutSeconds: 120 }, async (request) => {
  const actor = await requireAccess(request); requirePermission(actor, "banking.reconcile");
  const input = parseInput(prepareBankReconciliationInput, request.data), operation = db.doc(`idempotencyOperations/${uniquenessDocumentId(actor.organizationId, "prepareBankReconciliation", input.idempotencyKey)}`);
  const existingOperation = await operation.get();
  if (existingOperation.exists) return { reconciliationId: String(existingOperation.get("entityId")), reconciliationNumber: String(existingOperation.get("reconciliationNumber")), prepared: false };
  const evidence = await periodEvidence(actor.organizationId, input.bankAccountId, input.periodStart, input.periodEnd);
  const calculatedClosing = input.openingBalanceMinor + evidence.statementMovementMinor, differenceMinor = input.closingBalanceMinor - calculatedClosing;
  if (differenceMinor !== 0) throw new HttpsError("failed-precondition", `The closing balance differs from the reconciled movement by ${differenceMinor} kobo.`);
  const reconciliation = db.collection("bankReconciliations").doc(), counter = db.doc(`bankReconciliationCounters/${uniquenessDocumentId(actor.organizationId, "general")}`);
  let result = { reconciliationId: reconciliation.id, reconciliationNumber: "", prepared: true };
  await db.runTransaction(async (transaction) => {
    const [previous, currentCounter] = await transaction.getAll(operation, counter) as [FirebaseFirestore.DocumentSnapshot, FirebaseFirestore.DocumentSnapshot];
    if (previous.exists) { result = { reconciliationId: String(previous.get("entityId")), reconciliationNumber: String(previous.get("reconciliationNumber")), prepared: false }; return; }
    const sequence = Number(currentCounter.get("value") ?? 0) + 1, reconciliationNumber = numbered(sequence), now = FieldValue.serverTimestamp();
    transaction.set(counter, { organizationId: actor.organizationId, value: sequence, updatedAt: now });
    transaction.create(reconciliation, clean({ organizationId: actor.organizationId, bankAccountId: input.bankAccountId, bankName: evidence.account.get("bankName"), accountName: evidence.account.get("accountName"), accountNumberLast4: evidence.account.get("accountNumberLast4"), ledgerAccountCode: evidence.account.get("ledgerAccountCode"), reconciliationNumber, periodStart: input.periodStart, periodEnd: input.periodEnd, openingBalanceMinor: input.openingBalanceMinor, closingBalanceMinor: input.closingBalanceMinor, statementMovementMinor: evidence.statementMovementMinor, ledgerMovementMinor: evidence.ledgerMovementMinor, differenceMinor, statementTransactionCount: evidence.statements.length, journalLineCount: evidence.lines.length, statementTransactionIds: evidence.statements.map((document) => document.id), journalLineIds: evidence.lines.map((document) => document.id), notes: input.notes, status: "prepared", preparedAt: now, preparedBy: actor.userId, createdAt: now, updatedAt: now }));
    transaction.create(operation, { organizationId: actor.organizationId, action: "prepareBankReconciliation", entityId: reconciliation.id, reconciliationNumber, status: "completed", createdAt: now, createdBy: actor.userId });
    writeAuditLog(transaction, actor, { action: "bank_reconciliation.prepared", entityType: "bankReconciliation", entityId: reconciliation.id, correlationId: correlationId(), sourceFunction: "prepareBankReconciliation", after: { reconciliationNumber, differenceMinor, statementTransactionCount: evidence.statements.length, journalLineCount: evidence.lines.length } });
    result = { reconciliationId: reconciliation.id, reconciliationNumber, prepared: true };
  });
  return result;
});

export const completeBankReconciliation = onCall({ enforceAppCheck, timeoutSeconds: 120 }, async (request) => {
  const actor = await requireAccess(request); requirePermission(actor, "banking.approve");
  const input = parseInput(completeBankReconciliationInput, request.data), reconciliation = db.doc(`bankReconciliations/${input.reconciliationId}`), operation = db.doc(`idempotencyOperations/${uniquenessDocumentId(actor.organizationId, "completeBankReconciliation", input.idempotencyKey)}`);
  const [current, existingOperation] = await db.getAll(reconciliation, operation) as [FirebaseFirestore.DocumentSnapshot, FirebaseFirestore.DocumentSnapshot];
  if (existingOperation.exists) return { reconciliationId: reconciliation.id, status: "closed" };
  if (!current.exists || current.get("organizationId") !== actor.organizationId) throw new HttpsError("not-found", "Bank reconciliation not found.");
  if (current.get("status") !== "prepared") throw new HttpsError("failed-precondition", "Only a prepared reconciliation may be completed.");
  if (current.get("preparedBy") === actor.userId) throw new HttpsError("permission-denied", "The reconciliation preparer cannot complete their own reconciliation.", { code: "BANK_RECONCILIATION_SELF_APPROVAL_FORBIDDEN" });
  const statementReferences = (current.get("statementTransactionIds") as string[]).map((id) => db.doc(`bankStatementTransactions/${id}`)), lineReferences = (current.get("journalLineIds") as string[]).map((id) => db.doc(`journalLines/${id}`));
  await db.runTransaction(async (transaction) => {
    const snapshots = await transaction.getAll(reconciliation, operation, ...statementReferences, ...lineReferences), latest = snapshots[0]!, previous = snapshots[1]!;
    if (previous.exists) return;
    if (latest.get("status") !== "prepared" || latest.get("preparedBy") === actor.userId) throw new HttpsError("failed-precondition", "The reconciliation is no longer eligible for independent completion.");
    const statements = snapshots.slice(2, 2 + statementReferences.length), lines = snapshots.slice(2 + statementReferences.length), lineById = new Map(lines.map((line) => [line.id, line]));
    for (const statement of statements) {
      const line = lineById.get(String(statement.get("journalLineId")));
      if (!statement.exists || statement.get("status") !== "matched" || statement.get("reconciliationId") || !line || line.get("bankStatementTransactionId") !== statement.id) throw new HttpsError("failed-precondition", "A reconciliation match changed after preparation. Prepare it again.");
      assertMatch(statement, line, String(latest.get("ledgerAccountCode")));
    }
    const now = FieldValue.serverTimestamp();
    statements.forEach((statement) => transaction.update(statement.ref, { status: "reconciled", reconciliationId: reconciliation.id, reconciledAt: now, reconciledBy: actor.userId, updatedAt: now }));
    lines.forEach((line) => transaction.update(line.ref, { bankReconciled: true, bankReconciliationId: reconciliation.id, bankReconciledAt: now, bankReconciledBy: actor.userId }));
    transaction.update(reconciliation, clean({ status: "closed", completionNotes: input.notes, closedAt: now, closedBy: actor.userId, updatedAt: now }));
    transaction.create(operation, { organizationId: actor.organizationId, action: "completeBankReconciliation", entityId: reconciliation.id, status: "completed", createdAt: now, createdBy: actor.userId });
    writeAuditLog(transaction, actor, { action: "bank_reconciliation.closed", entityType: "bankReconciliation", entityId: reconciliation.id, correlationId: correlationId(), sourceFunction: "completeBankReconciliation", after: { status: "closed", differenceMinor: latest.get("differenceMinor") } });
  });
  return { reconciliationId: reconciliation.id, status: "closed" };
});

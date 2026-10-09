import { createHash } from "node:crypto";
import { FieldPath, FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import { hasServerPermission, requireAccess, requireBranchScope, requirePermission } from "../auth/authorize.js";
import { accountingPeriodReference, assertAccountingPeriodOpen } from "../accounting/period-lock.js";
import { assertSafeJournal } from "../accounting/journal-validation.js";
import { writeJournal } from "../accounting/write-journal.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import { enforceAppCheck } from "../config.js";
import { uniquenessDocumentId } from "../inventory/calculations.js";
import { correlationId, parseInput } from "../utils/callable.js";
import { accountingJournalInput, canConfigureManualAccount, isOperationalControlCode } from "../validation/manual-journals.js";

const fail = (message: string): never => { throw new HttpsError("failed-precondition", message); };
function row(document: FirebaseFirestore.DocumentSnapshot) {
  const data = document.data() ?? {};
  return { id: document.id, ...Object.fromEntries(Object.entries(data).map(([key, value]) =>
    [key, value instanceof Timestamp ? value.toDate().toISOString() : value])) };
}
export const accountingJournals = onCall({ enforceAppCheck }, async request => {
  const actor = await requireAccess(request);
  const input = parseInput(accountingJournalInput, request.data);
  requirePermission(actor, input.action === "post" ? "finance.journal.create" : input.action === "reverse" ? "finance.journal.reverse" : input.action === "save_account" ? "finance.accounts.manage" : "finance.journal.read");
  const organizationWide = hasServerPermission(actor, "sales.read.all");
  const assertScope = (branchId?: string) => {
    if (branchId) requireBranchScope(actor, branchId);
    else if (!organizationWide) throw new HttpsError("permission-denied", "Select an assigned store for this accounting record.");
  };
  if (input.action === "detail") {
    const entry = await db.doc(`journalEntries/${input.journalEntryId}`).get();
    if (!entry.exists || entry.get("organizationId") !== actor.organizationId) throw new HttpsError("not-found", "Journal not found.");
    assertScope(entry.get("branchId"));
    const lines = await db.collection("journalLines").where("organizationId", "==", actor.organizationId).where("journalEntryId", "==", entry.id).limit(201).get();
    return { entry: row(entry), lines: lines.docs.slice(0, 200).map(row), truncated: lines.size > 200 };
  }
  if (input.action === "workspace") {
    const branchId = input.branchId ?? (!organizationWide && actor.branchIds.length === 1 ? actor.branchIds[0] : undefined);
    assertScope(branchId);
    let query: FirebaseFirestore.Query = db.collection("journalEntries").where("organizationId", "==", actor.organizationId)
      .where("effectiveAt", ">=", Timestamp.fromDate(new Date(`${input.fromDate}T00:00:00Z`)))
      .where("effectiveAt", "<=", Timestamp.fromDate(new Date(`${input.toDate}T23:59:59.999Z`)));
    if (branchId) query = query.where("branchId", "==", branchId);
    query = query.orderBy("effectiveAt", "desc").orderBy(FieldPath.documentId(), "desc");
    if (input.cursorId) {
      const cursor = await db.doc(`journalEntries/${input.cursorId}`).get();
      const date = cursor.get("effectiveAt");
      if (!cursor.exists || cursor.get("organizationId") !== actor.organizationId || (branchId && cursor.get("branchId") !== branchId) || !(date instanceof Timestamp) || date.toDate().toISOString().slice(0, 10) < input.fromDate || date.toDate().toISOString().slice(0, 10) > input.toDate)
        throw new HttpsError("invalid-argument", "The page cursor does not belong to these filters.");
      query = query.startAfter(cursor);
    }
    const [entries, accounts, banks] = await Promise.all([
      query.limit(input.pageSize + 1).get(),
      db.collection("chartOfAccounts").where("organizationId", "==", actor.organizationId).limit(201).get(),
      db.collection("bankAccounts").where("organizationId", "==", actor.organizationId).limit(201).get(),
    ]);
    if (accounts.size > 200 || banks.size > 200) fail("This organization needs a paged account selector before manual journal entry. No accounts were silently omitted.");
    return { entries: entries.docs.slice(0, input.pageSize).map(row), nextCursorId: entries.size > input.pageSize ? entries.docs[input.pageSize - 1]!.id : null,
      accounts: accounts.docs.map(row), bankAccounts: banks.docs.map(row), branchId: branchId ?? null };
  }
  if (input.action === "save_account" && !organizationWide)
    throw new HttpsError("permission-denied", "Company account configuration requires organization-wide accounting access.");
  const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const operation = db.doc(`idempotencyOperations/${uniquenessDocumentId(actor.organizationId, "accountingJournals", input.idempotencyKey)}`);
  const journal = db.collection("journalEntries").doc();
  const counter = db.doc(`journalCounters/${uniquenessDocumentId(actor.organizationId, "general")}`);
  return db.runTransaction(async transaction => {
    const previous = await transaction.get(operation);
    if (previous.exists) {
      if (previous.get("organizationId") !== actor.organizationId || previous.get("fingerprint") !== fingerprint) fail("This retry key belongs to different accounting instructions.");
      return previous.get("result");
    }
    if (input.action === "save_account") {
      if (!canConfigureManualAccount(input.code)) fail("Use the existing banking, inventory, customer, supplier or tax workflow for this control account.");
      const matches = await transaction.get(db.collection("chartOfAccounts").where("organizationId", "==", actor.organizationId).where("code", "==", input.code).limit(2));
      if (matches.size > 1) fail("Duplicate account codes require reconciliation before editing.");
      const existing = matches.docs[0];
      if (existing?.get("systemManaged") === true) fail("This account is managed by its operational workflow.");
      const account = existing?.ref ?? db.doc(`chartOfAccounts/${uniquenessDocumentId(actor.organizationId, input.code)}`);
      const canonical = existing ?? await transaction.get(account);
      if (canonical.exists && canonical.get("organizationId") !== actor.organizationId) fail("The account reference is unavailable.");
      if (canonical.exists && (canonical.get("code") !== input.code || (canonical.get("currency") && canonical.get("currency") !== "NGN"))) fail("This account requires reconciliation before editing.");
      transaction.set(account, { organizationId: actor.organizationId, code: input.code, name: input.name, active: input.active,
        currency: "NGN", systemManaged: false, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.userId }, { merge: true });
      const result = { accountId: account.id, saved: true };
      transaction.create(operation, { organizationId: actor.organizationId, fingerprint, result, createdAt: FieldValue.serverTimestamp() });
      writeAuditLog(transaction, actor, { action: "accounting.account_saved", entityType: "chartOfAccounts", entityId: account.id,
        correlationId: correlationId(), sourceFunction: "accountingJournals", reason: input.reason,
        ...(canonical.exists ? { before: { code: canonical.get("code"), name: canonical.get("name"), active: canonical.get("active") ?? true } } : {}),
        after: { code: input.code, name: input.name, active: input.active } });
      return result;
    }
    assertScope(input.branchId);
    const effectiveAt = Timestamp.fromDate(new Date(input.effectiveAt));
    if (effectiveAt.toMillis() > Date.now() + 300_000) throw new HttpsError("invalid-argument", "The posting date cannot be in the future.");
    const [period, sequence, branch] = await Promise.all([accountingPeriodReference(actor.organizationId, effectiveAt), counter, db.doc(`branches/${input.branchId}`)].map(ref => transaction.get(ref)));
    if (!period || !sequence || !branch || !branch.exists || branch.get("organizationId") !== actor.organizationId || branch.get("status") === "inactive") fail("Select an active store for this journal.");
    assertAccountingPeriodOpen(period!);
    let cashFlowActivity: "operating" | "investing" | "financing";
    let lines: Array<{ accountId: string; bankAccountId?: string; accountCode: string; accountName: string; debitMinor: number; creditMinor: number }>;
    let original: FirebaseFirestore.DocumentSnapshot | undefined;
    let bankEvidence: Array<{ bankAccountId: string; accountCode: string; accountName: string }> = [];
    if (input.action === "reverse") {
      original = await transaction.get(db.doc(`journalEntries/${input.journalEntryId}`));
      if (!original.exists || original.get("organizationId") !== actor.organizationId || original.get("branchId") !== input.branchId) fail("The original journal is not in this store.");
      if (original.get("journalType") !== "manual_adjustment" || original.get("status") !== "posted") fail("Only manual journals can be reversed here. Correct operational transactions in their own workflow.");
      if (original.get("reversalJournalEntryId")) fail("This manual journal already has a reversal.");
      const originalLines = await transaction.get(db.collection("journalLines").where("organizationId", "==", actor.organizationId).where("journalEntryId", "==", original.id).limit(41));
      if (originalLines.size < 2 || originalLines.size > 40) fail("The original journal requires reconciliation.");
      lines = originalLines.docs.map(line => ({ accountId: String(line.get("accountId")), accountCode: String(line.get("accountCode")), accountName: String(line.get("accountName")), debitMinor: Number(line.get("creditMinor")), creditMinor: Number(line.get("debitMinor")), ...(line.get("bankAccountId") ? { bankAccountId: String(line.get("bankAccountId")) } : {}) }));
      if (lines.some(line => isOperationalControlCode(line.accountCode))) fail("Operational control accounts cannot be reversed outside their workflow.");
      cashFlowActivity = original.get("cashFlowActivity");
      if (!["operating", "investing", "financing"].includes(cashFlowActivity)) fail("The original cash-flow classification requires review.");
      if (original.get("totalDebitMinor") !== lines.reduce((sum, line) => sum + line.creditMinor, 0) || original.get("totalCreditMinor") !== lines.reduce((sum, line) => sum + line.debitMinor, 0)) fail("The original lines and header do not agree.");
      bankEvidence = original.get("details.bankAccounts") ?? [];
    } else {
      const accounts = await Promise.all(input.lines.map(line => transaction.get(db.doc(`chartOfAccounts/${line.accountId}`))));
      const banks = await Promise.all(input.lines.map(line => line.bankAccountId ? transaction.get(db.doc(`bankAccounts/${line.bankAccountId}`)) : undefined));
      const moneyAccounts = new Map<string, FirebaseFirestore.QuerySnapshot>();
      for (const account of accounts) {
        const code = String(account.get("code"));
        if (/^10\d{2}$/.test(code) && code !== "1010" && !moneyAccounts.has(code))
          moneyAccounts.set(code, await transaction.get(db.collection("bankAccounts").where("organizationId", "==", actor.organizationId).where("ledgerAccountCode", "==", code).where("active", "==", true).limit(2)));
      }
      lines = input.lines.map((line, index) => {
        const account = accounts[index]!;
        if (!account.exists || account.get("organizationId") !== actor.organizationId || account.get("active") !== true || !/^[1-9]\d{3}$/.test(String(account.get("code"))) || (account.get("currency") && account.get("currency") !== "NGN") || !String(account.get("name") ?? "").trim()) fail("Choose active company NGN ledger accounts.");
        const accountCode = String(account.get("code"));
        if (isOperationalControlCode(accountCode)) fail("Use the operational workflow for inventory, customer/supplier balances, tax and retained earnings.");
        const bank = banks[index];
        if (/^10\d{2}$/.test(accountCode) && accountCode !== "1010") {
          if (!bank?.exists || bank.get("organizationId") !== actor.organizationId || bank.get("active") !== true || bank.get("ledgerAccountCode") !== accountCode) fail("Select the active company financial account for this money line.");
          if (moneyAccounts.get(accountCode)?.size !== 1) fail("This ledger code is shared by multiple financial accounts. Give each account its own code before posting manual money entries.");
          bankEvidence.push({ bankAccountId: bank!.id, accountCode, accountName: String(bank!.get("accountName")) });
        } else if (line.bankAccountId) fail("A financial account was supplied for a non-bank ledger line.");
        return { accountId: account.id, accountCode, accountName: String(account.get("name")), debitMinor: line.debitMinor, creditMinor: line.creditMinor, ...(line.bankAccountId ? { bankAccountId: line.bankAccountId } : {}) };
      });
      cashFlowActivity = input.cashFlowActivity;
    }
    try { assertSafeJournal(lines); } catch { fail("Journal lines must balance using safe positive debit and credit amounts."); }
    const referenceNumber = `MJN-${input.idempotencyKey.replaceAll("-", "").slice(0, 16).toUpperCase()}`;
    const journalNumber = writeJournal(transaction, actor, { journal, journalCounter: counter, journalCounterValue: Number(sequence!.get("value") ?? 0) + 1,
      journalType: original ? "manual_reversal" : "manual_adjustment", referenceType: original ? "journalReversal" : "manualJournal", referenceId: original?.id ?? journal.id,
      referenceNumber, description: input.reference, branchId: input.branchId, effectiveAt, cashFlowActivity, manageAccounts: false,
      details: { reason: input.reason, purpose: input.action === "post" ? input.purpose : "reversal", bankAccounts: bankEvidence,
        ...(original ? { originalJournalEntryId: original.id, originalJournalNumber: original.get("journalNumber") } : {}) }, lines });
    // Keep the original posted amounts and status. Only add the correction link.
    if (original) transaction.update(original.ref, { reversalJournalEntryId: journal.id, reversedAt: FieldValue.serverTimestamp(), reversedBy: actor.userId });
    const result = { journalEntryId: journal.id, journalNumber, referenceNumber, posted: true };
    transaction.create(operation, { organizationId: actor.organizationId, fingerprint, result, createdAt: FieldValue.serverTimestamp() });
    writeAuditLog(transaction, actor, { action: original ? "accounting.manual_journal_reversed" : "accounting.manual_journal_posted", entityType: "journalEntry", entityId: journal.id,
      correlationId: correlationId(), sourceFunction: "accountingJournals", reason: input.reason,
      after: { journalNumber, referenceNumber, branchId: input.branchId, cashFlowActivity, lines, ...(original ? { originalJournalEntryId: original.id } : {}) } });
    return result;
  });
});

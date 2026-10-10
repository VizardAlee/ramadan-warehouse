import { createHash } from "node:crypto";
import { FieldPath, FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import { hasServerPermission, requireAccess, requireBranchScope, requirePermission } from "../auth/authorize.js";
import { budgetInput, budgetMonthDates, budgetMonths, budgetVariance } from "../accounting/budgets.js";
import { dailyBounds } from "../accounting/daily-close.js";
import { uniquenessDocumentId } from "../inventory/calculations.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import { correlationId, parseInput } from "../utils/callable.js";
import { visitQueryPages } from "../utils/query-pages.js";
import { enforceAppCheck } from "../config.js";

const fail = (message: string): never => { throw new HttpsError("failed-precondition", message); };
const row = (doc: FirebaseFirestore.DocumentSnapshot) => ({ id: doc.id, ...Object.fromEntries(Object.entries(doc.data() ?? {}).map(([key, value]) => [key, value instanceof Timestamp ? value.toDate().toISOString() : value])) });
export const budgetWorkspace = onCall({ enforceAppCheck, timeoutSeconds: 300 }, async request => {
  const actor = await requireAccess(request), input = parseInput(budgetInput, request.data);
  requirePermission(actor, input.action === "save" ? "finance.budget.manage" : "finance.journal.read");
  const scope = (branchId?: string) => {
    if (branchId) requireBranchScope(actor, branchId);
    else if (!hasServerPermission(actor, "sales.read.all")) throw new HttpsError("permission-denied", "Select an assigned store. Consolidated budgets require organization-wide finance access.");
  };
  if (input.action === "history") {
    const budget = await db.doc(`budgets/${input.budgetId}`).get();
    if (!budget.exists || budget.get("organizationId") !== actor.organizationId) throw new HttpsError("not-found", "Budget not found.");
    scope(budget.get("branchId") ?? undefined);
    let query: FirebaseFirestore.Query = db.collection("budgetRevisions").where("organizationId", "==", actor.organizationId).where("budgetId", "==", budget.id).orderBy(FieldPath.documentId());
    if (input.cursorId) {
      const cursor = await db.doc(`budgetRevisions/${input.cursorId}`).get();
      if (!cursor.exists || cursor.get("organizationId") !== actor.organizationId || cursor.get("budgetId") !== budget.id) throw new HttpsError("invalid-argument", "This history cursor belongs to another budget.");
      query = query.startAfter(cursor);
    }
    const page = await query.limit(26).get();
    const documents = page.docs.slice(0, 25);
    const staffIds = [...new Set(documents.map(doc => String(doc.get("updatedBy") ?? "")).filter(id => /^[A-Za-z0-9_-]{1,128}$/.test(id)))];
    const staff = staffIds.length ? await db.getAll(...staffIds.map(id => db.doc(`users/${id}`))) : [];
    const names = new Map(staff.filter(doc => doc.exists && doc.get("organizationId") === actor.organizationId).map(doc => [doc.id, String(doc.get("displayName") ?? doc.get("email") ?? "Staff member")]));
    return { revisions: documents.map(doc => ({ ...row(doc), updatedByName: names.get(doc.get("updatedBy")) ?? "Historical staff member" })), nextCursorId: page.size > 25 ? page.docs[24]!.id : null };
  }
  scope(input.branchId);
  const scopeKey = input.branchId ? `store:${input.branchId}` : "organization";
  if (input.action === "comparison") {
    const months = budgetMonths(input.fromMonth, input.toMonth);
    const rows: Array<Record<string, unknown>> = [];
    // Reuse the established monthly query: organization targets and store targets remain separate.
    for (const month of months) {
      const targets = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
      await visitQueryPages(db.collection("budgets").where("organizationId", "==", actor.organizationId).where("month", "==", month).where("scopeKey", "==", scopeKey), docs => {
        for (const doc of docs) {
          const code = String(doc.get("accountCode"));
          if (targets.has(code)) fail("Duplicate targets exist for this month and account. Reconcile them before comparing.");
          targets.set(code, doc);
        }
      });
      const totals = new Map<string, { debit: number; credit: number }>();
      for (const code of targets.keys()) totals.set(code, { debit: 0, credit: 0 });
      const dates = budgetMonthDates(month);
      // Exclusive next-day boundary includes the final Firestore nanoseconds of the month.
      const end = Timestamp.fromMillis(Date.parse(`${dates.toDate}T00:00:00+01:00`) + 86_400_000);
      let ledger: FirebaseFirestore.Query = db.collection("journalLines").where("organizationId", "==", actor.organizationId)
        .where("effectiveAt", ">=", dailyBounds(dates.fromDate).start).where("effectiveAt", "<", end);
      if (input.branchId) ledger = ledger.where("branchId", "==", input.branchId);
      if (totals.size) await visitQueryPages(ledger, docs => {
        for (const doc of docs) {
          const total = totals.get(String(doc.get("accountCode"))); if (!total) continue;
          const debit = doc.get("debitMinor") ?? 0, credit = doc.get("creditMinor") ?? 0;
          if (![debit, credit].every(value => typeof value === "number" && Number.isSafeInteger(value) && value >= 0)) fail("A budgeted account contains invalid ledger amounts. Reconcile it before comparing.");
          total.debit += debit; total.credit += credit;
          if (![total.debit, total.credit].every(Number.isSafeInteger)) fail("Ledger totals exceed safe minor-unit arithmetic.");
        }
      }, { orderField: "effectiveAt" });
      if (rows.length + targets.size > 10_000) fail("This comparison exceeds 10,000 targets. Choose fewer months; no partial totals were returned.");
      for (const [code, target] of targets) {
        const total = totals.get(code)!;
        try { rows.push({ ...row(target), ...budgetVariance(code, target.get("amountMinor"), total.debit, total.credit) }); }
        catch { fail("A budget has invalid amounts or account classification. Review it before comparing."); }
      }
    }
    return { rows, months, branchId: input.branchId ?? null };
  }
  if (input.action === "workspace") {
    let query: FirebaseFirestore.Query = db.collection("budgets").where("organizationId", "==", actor.organizationId).where("month", "==", input.month).where("scopeKey", "==", scopeKey).orderBy(FieldPath.documentId());
    if (input.cursorId) {
      const cursor = await db.doc(`budgets/${input.cursorId}`).get();
      if (!cursor.exists || cursor.get("organizationId") !== actor.organizationId || cursor.get("month") !== input.month || cursor.get("scopeKey") !== scopeKey) throw new HttpsError("invalid-argument", "This budget cursor belongs to another period or store.");
      query = query.startAfter(cursor);
    }
    const [page, accounts] = await Promise.all([query.limit(input.pageSize + 1).get(), db.collection("chartOfAccounts").where("organizationId", "==", actor.organizationId).limit(501).get()]);
    if (accounts.size > 500) fail("The account picker requires paging before more than 500 ledger accounts can be used. No accounts were silently omitted.");
    const dates = budgetMonthDates(input.month), totals = new Map<string, { debit: number; credit: number }>();
    for (const doc of page.docs.slice(0, input.pageSize)) totals.set(String(doc.get("accountCode")), { debit: 0, credit: 0 });
    let ledger: FirebaseFirestore.Query = db.collection("journalLines").where("organizationId", "==", actor.organizationId).where("effectiveAt", ">=", dailyBounds(dates.fromDate).start).where("effectiveAt", "<", Timestamp.fromMillis(Date.parse(`${dates.toDate}T00:00:00+01:00`) + 86_400_000));
    if (input.branchId) ledger = ledger.where("branchId", "==", input.branchId);
    if (totals.size) await visitQueryPages(ledger, lines => {
      for (const line of lines) {
        const total = totals.get(String(line.get("accountCode"))); if (!total) continue;
        const debit = line.get("debitMinor") ?? 0, credit = line.get("creditMinor") ?? 0;
        if (![debit, credit].every(value => typeof value === "number" && Number.isSafeInteger(value) && value >= 0)) fail("A budgeted account contains invalid ledger amounts. Reconcile it before reviewing actuals.");
        total.debit += debit; total.credit += credit;
        if (![total.debit, total.credit].every(Number.isSafeInteger)) fail("Ledger totals exceed safe minor-unit arithmetic.");
      }
    }, { orderField: "effectiveAt" });
    const rows = page.docs.slice(0, input.pageSize).map(doc => {
      const total = totals.get(String(doc.get("accountCode")))!;
      try { return { ...row(doc), ...budgetVariance(doc.get("accountCode"), doc.get("amountMinor"), total.debit, total.credit) }; }
      catch { return fail("A budget contains invalid amounts or account classifications. Review it before using the comparison."); }
    });
    return { rows, accounts: accounts.docs.filter(doc => /^[4-9]\d{3}$/.test(String(doc.get("code")))).map(row), nextCursorId: page.size > input.pageSize ? page.docs[input.pageSize - 1]!.id : null, ...dates, branchId: input.branchId ?? null };
  }
  const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const operation = db.doc(`idempotencyOperations/${uniquenessDocumentId(actor.organizationId, "budgetWorkspace", input.idempotencyKey)}`);
  const budgetId = createHash("sha256").update(JSON.stringify([actor.organizationId, input.month, scopeKey, input.accountId])).digest("hex");
  const ref = db.doc(`budgets/${budgetId}`);
  return db.runTransaction(async transaction => {
    const prior = await transaction.get(operation);
    if (prior.exists) {
      if (prior.get("organizationId") !== actor.organizationId || prior.get("fingerprint") !== fingerprint) fail("This retry key belongs to different budget instructions.");
      return prior.get("result");
    }
    const [current, account, branch] = await Promise.all([transaction.get(ref), transaction.get(db.doc(`chartOfAccounts/${input.accountId}`)), input.branchId ? transaction.get(db.doc(`branches/${input.branchId}`)) : Promise.resolve(null)]);
    if (!account.exists || account.get("organizationId") !== actor.organizationId || account.get("active") !== true || !/^[4-9]\d{3}$/.test(String(account.get("code")))) fail("Select an active income or expense ledger account.");
    if (branch && (!branch.exists || branch.get("organizationId") !== actor.organizationId || branch.get("active") === false || ![undefined, "active"].includes(branch.get("status")))) fail("Select an active store in this organization.");
    const previousVersion = current.exists ? current.get("version") : 0;
    if (previousVersion !== input.expectedVersion) fail("This budget changed since you opened it. Refresh and review the latest version before saving.");
    const version = previousVersion + 1;
    const after = { organizationId: actor.organizationId, month: input.month, scopeKey, branchId: input.branchId ?? null, accountId: account.id, accountCode: account.get("code"), accountName: account.get("name"), amountMinor: input.amountMinor, version, reason: input.reason, updatedBy: actor.userId };
    transaction.set(ref, { ...after, updatedAt: FieldValue.serverTimestamp() });
    transaction.create(db.doc(`budgetRevisions/${ref.id}_${String(version).padStart(7, "0")}`), { ...after, budgetId: ref.id, previousAmountMinor: current.get("amountMinor") ?? null, createdAt: FieldValue.serverTimestamp() });
    const result = { budgetId: ref.id, version };
    transaction.create(operation, { organizationId: actor.organizationId, fingerprint, result, createdAt: FieldValue.serverTimestamp() });
    writeAuditLog(transaction, actor, { action: "budget.revised", entityType: "budget", entityId: ref.id, reason: input.reason, correlationId: correlationId(), sourceFunction: "budgetWorkspace", before: current.exists ? { amountMinor: current.get("amountMinor"), version: previousVersion } : {}, after });
    return result;
  });
});

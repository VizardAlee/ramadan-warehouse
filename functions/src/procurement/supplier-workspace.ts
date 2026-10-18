import { createHash } from "node:crypto";
import { FieldPath, Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import { requirePermission, hasServerPermission } from "../auth/authorize.js";
import { hasOrganizationPermission, hasPermissionScope, type ScopedAccess } from "../auth/permission-scope.js";
import { hasOrganizationProcurementPermission, hasProcurementScope, requireProcurementScope, type ProcurementAccess } from "./authorize.js";
import { visitQueryPages } from "../utils/query-pages.js";
import { bankAccountSummary } from "../accounting/settlement-account.js";

type Scope = { branchId?: string; warehouseId?: string };
type Input = Scope & { supplierId?: string; search?: string; cursor?: string; limit: number; from?: string; through?: string; complete?: boolean };
const scopeOf = (record: FirebaseFirestore.DocumentSnapshot): Scope => ({ branchId: record.get("branchId") || undefined, warehouseId: record.get("warehouseId") || undefined });
const fail = (message: string): never => { throw new HttpsError("failed-precondition", message); };
const safe = (value: unknown) => { if (typeof value !== "number" || !Number.isSafeInteger(value)) fail("Supplier ledger amounts require reconciliation."); return value as number; };
const inside = (record: FirebaseFirestore.DocumentSnapshot, input: Scope) => (!input.branchId || record.get("branchId") === input.branchId) && (!input.warehouseId || record.get("warehouseId") === input.warehouseId);
function requireReadScope(actor: ProcurementAccess, input: Scope) {
  requirePermission(actor, "payables.read");
  if (input.branchId || input.warehouseId) requireProcurementScope(actor, input, ["procurement.read", "payables.read"]);
  else if (!hasOrganizationProcurementPermission(actor, "payables.read") || !hasOrganizationProcurementPermission(actor, "procurement.read"))
    throw new HttpsError("permission-denied", "Select an assigned store for this supplier account.");
}
export function supplierSummary(actor: ProcurementAccess, record: FirebaseFirestore.DocumentSnapshot) {
  const data = record.data()!;
  const summary: Record<string, unknown> = { id: record.id, organizationId: actor.organizationId, supplierNumber: data.supplierNumber, name: data.name, supplierType: data.supplierType ?? "goods", phone: data.phone ?? null, email: data.email ?? null, address: data.address ?? null, taxId: data.taxId ?? null, paymentTermsDays: data.paymentTermsDays ?? 0, active: data.active, currency: "NGN" };
  if (hasOrganizationProcurementPermission(actor, "payables.read")) {
    summary.outstandingBalanceMinor = data.outstandingBalanceMinor ?? 0; summary.advanceBalanceMinor = data.advanceBalanceMinor ?? 0;
  }
  for (const field of ["advanceBalancesByLocation", "advanceSourceBalancesByLocation"]) {
    summary[field] = Object.fromEntries(Object.entries(data[field] ?? {}).filter(([key]) => hasProcurementScope(actor, key.startsWith("branch:") ? { branchId: key.slice(7) } : key.startsWith("warehouse:") ? { warehouseId: key.slice(10) } : {}, "payables.read")));
  }
  return summary;
}
async function supplier(actor: ProcurementAccess, id: string | undefined) {
  if (!id) throw new HttpsError("invalid-argument", "Choose a supplier.");
  const record = await db.doc(`suppliers/${id}`).get();
  if (!record.exists || record.get("organizationId") !== actor.organizationId) throw new HttpsError("not-found", "Supplier not found.");
  return record;
}
export async function supplierDirectory(actor: ProcurementAccess, input: Input) {
  let query = db.collection("suppliers").where("organizationId", "==", actor.organizationId).orderBy(FieldPath.documentId());
  if (input.cursor) {
    const cursor = await db.doc(`suppliers/${input.cursor}`).get();
    if (!cursor.exists || cursor.get("organizationId") !== actor.organizationId) throw new HttpsError("invalid-argument", "Restart the supplier directory after changing filters.");
    query = query.startAfter(cursor);
  }
  const needle = (input.search ?? "").toLocaleLowerCase("en-NG");
  const rows: Record<string, unknown>[] = [];
  let scanned = 0, last: string | null = null, hasNext = false;
  while (rows.length < Math.min(input.limit, 100) && scanned < 500) {
    const page = await query.limit(Math.min(100, 500 - scanned)).get();
    if (page.empty) { hasNext = false; break; }
    for (const record of page.docs) {
      scanned++; last = record.id;
      if (!needle || ["name", "supplierNumber", "phone", "email", "supplierType"].some(field => String(record.get(field) ?? "").toLocaleLowerCase("en-NG").includes(needle))) rows.push(supplierSummary(actor, record));
      if (rows.length === Math.min(input.limit, 100)) break;
    }
    hasNext = true;
    if (rows.length === Math.min(input.limit, 100) || scanned === 500) break;
    if (page.size < Math.min(100, 500 - scanned + page.size)) { hasNext = false; break; }
    query = query.startAfter(page.docs.at(-1)!);
  }
  return { rows, nextCursor: hasNext ? last : null, scanned, search: input.search ?? "", note: "Search checks up to 500 supplier records per page, including historical records without search fields. Continue with Next until the end; an empty search page can still have more records." };
}
export async function supplierProfile(actor: ProcurementAccess, input: Input) {
  const record = await supplier(actor, input.supplierId);
  const [branches, warehouses, banks] = await Promise.all([
    db.collection("branches").where("organizationId", "==", actor.organizationId).where("status", "==", "active").get(),
    db.collection("warehouses").where("organizationId", "==", actor.organizationId).where("status", "==", "active").get(),
    hasServerPermission(actor, "payables.pay") ? db.collection("bankAccounts").where("organizationId", "==", actor.organizationId).where("active", "==", true).get() : Promise.resolve(null),
  ]);
  return { supplier: supplierSummary(actor, record), organizationWide: hasOrganizationProcurementPermission(actor, "payables.read") && hasOrganizationProcurementPermission(actor, "procurement.read"),
    branches: branches.docs.filter(row => hasProcurementScope(actor, { branchId: row.id }, "procurement.read")).map(row => ({ id: row.id, name: row.get("name") })),
    warehouses: warehouses.docs.filter(row => hasProcurementScope(actor, { warehouseId: row.id }, "procurement.read")).map(row => ({ id: row.id, name: row.get("name") })), banks: banks?.docs.map(bankAccountSummary) ?? [] };
}
async function readRows(actor: ProcurementAccess, collection: string, supplierId: string) {
  const records: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  await visitQueryPages(db.collection(collection).where("organizationId", "==", actor.organizationId).where("supplierId", "==", supplierId), page => {
    records.push(...page); if (records.length > 10000) fail("This supplier exceeds the 10,000-record history limit. No partial history was returned; ask finance to arrange a larger audited export.");
  }, { pageSize: 100 });
  return records;
}
export async function supplierStatement(actor: ProcurementAccess, input: Input) {
  requireReadScope(actor, input); const party = await supplier(actor, input.supplierId);
  const records = (await readRows(actor, "supplierAccountEntries", party.id)).filter(row => inside(row, input) && hasProcurementScope(actor, scopeOf(row), "payables.read"));
  if (records.some(row => !(row.get("effectiveAt") instanceof Timestamp))) fail("Undated supplier entries require reconciliation before a complete statement can be issued.");
  records.sort((a,b) => a.get("effectiveAt").valueOf().localeCompare(b.get("effectiveAt").valueOf()) || a.id.localeCompare(b.id));
  const from = input.from ? Date.parse(`${input.from}T00:00:00+01:00`) : -Infinity;
  const through = input.through ? Date.parse(`${input.through}T00:00:00+01:00`) + 86400000 : Infinity;
  let payable = 0, advance = 0, openingPayable = 0, openingAdvance = 0;
  const entries: Array<Record<string, unknown> & { id: string }> = [];
  for (const row of records) {
    if (row.get("effectiveAt").toMillis() >= through) break;
    payable = safe(payable + safe(row.get("amountMinor"))); advance = safe(advance + safe(row.get("advanceAmountMinor") ?? 0));
    if (row.get("effectiveAt").toMillis() < from) { openingPayable = payable; openingAdvance = advance; continue; }
    entries.push({ ...(!input.branchId && !input.warehouseId ? { balanceAfterMinor: row.get("balanceAfterMinor") ?? null, advanceBalanceAfterMinor: row.get("advanceBalanceAfterMinor") ?? null } : {}), id: row.id, entryType: row.get("entryType"), referenceType: row.get("referenceType") ?? null, referenceId: row.get("referenceId") ?? null, referenceNumber: row.get("referenceNumber") ?? row.id, branchId: row.get("branchId") ?? null, warehouseId: row.get("warehouseId") ?? null, amountMinor: row.get("amountMinor"), advanceAmountMinor: row.get("advanceAmountMinor") ?? 0, effectiveAt: row.get("effectiveAt"), journalEntryId: row.get("journalEntryId") ?? null, runningPayableMinor: payable, runningAdvanceMinor: advance });
  }
  const version = createHash("sha256").update(JSON.stringify([party.id, input.branchId, input.warehouseId, input.from, input.through, openingPayable, openingAdvance, entries])).digest("hex");
  const newest = [...entries].reverse(); let start = 0;
  if (input.cursor) { const position = newest.findIndex(row => row.id === input.cursor); if (position < 0) throw new HttpsError("invalid-argument", "Restart supplier history after changing filters."); start = position + 1; }
  const page = input.complete ? entries : newest.slice(start, start + Math.min(input.limit, 100));
  return { supplier: { id: party.id, name: party.get("name"), supplierNumber: party.get("supplierNumber") }, entries: page, statementVersion: version,
    openingPayableMinor: openingPayable, openingAdvanceMinor: openingAdvance, closingPayableMinor: payable, closingAdvanceMinor: advance,
    nextCursor: !input.complete && start + page.length < newest.length ? page.at(-1)!.id : null,
    from: input.from ?? null, through: input.through ?? null, branchId: input.branchId ?? null, warehouseId: input.warehouseId ?? null,
    scopeNote: `${input.branchId || input.warehouseId ? "Selected-store" : "Consolidated"} recorded ledger only. Running balances include earlier scoped history. Legacy entries without a store are excluded from store views. Current control balances may include historical openings not represented here.`, complete: Boolean(input.complete) };
}
export async function supplierActivity(actor: ProcurementAccess, input: Input) {
  requireReadScope(actor, input); const party = await supplier(actor, input.supplierId);
  const from = input.from ? Date.parse(`${input.from}T00:00:00+01:00`) : -Infinity, through = input.through ? Date.parse(`${input.through}T00:00:00+01:00`) + 86400000 : Infinity;
  const accountRecords = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  const events: Array<{ advanceChangeMinor?: number; moneyAmountMinor?: number | null; moneyDirection?: string; stockReference?: string | null; journalEntryId?: string | null; id: string; at: string; kind: string; reference: string; amountMinor: number | null; quantity: number | null; detail: string; href: string }> = [];
  for (const [collection, field, kind] of [["purchaseOrders", "createdAt", "Purchase order"], ["purchaseReceipts", "receivedAt", "Goods received"], ["supplierAccountEntries", "effectiveAt", "Account movement"]]) {
    for (const row of await readRows(actor, collection!, party.id)) {
      if (!inside(row, input) || !hasProcurementScope(actor, scopeOf(row), collection === "supplierAccountEntries" ? "payables.read" : "procurement.read")) continue;
      const at = row.get(field!); if (!(at instanceof Timestamp) || at.toMillis() < from || at.toMillis() >= through) continue;
      if (collection === "supplierAccountEntries") accountRecords.set(`${collection}:${row.id}`, row);
      events.push({ advanceChangeMinor: collection === "supplierAccountEntries" ? safe(row.get("advanceAmountMinor") ?? 0) : 0, journalEntryId: row.get("journalEntryId") ?? null, id: `${collection}:${row.id}`, at: at.toDate().toISOString(), kind: kind!, reference: row.get("referenceNumber") ?? row.get("receiptNumber") ?? row.get("purchaseOrderNumber") ?? row.id, amountMinor: collection === "supplierAccountEntries" ? safe(row.get("amountMinor")) : null, quantity: collection === "purchaseReceipts" ? row.get("quantity") : null, detail: collection === "supplierAccountEntries" ? String(row.get("entryType")).replaceAll("_", " ") : collection === "purchaseReceipts" ? "Physical stock received; invoice payable is recorded separately" : "Order instruction; no new stock or payable posting", href: "/procurement" });
    }
  }
  const financialActor = actor as unknown as ScopedAccess;
  const providerVisible = hasServerPermission(actor, "expenses.read") && (input.branchId ? hasPermissionScope(financialActor, input, "expenses.read") : !input.warehouseId && hasOrganizationPermission(financialActor, "expenses.read"));
  let providerObligationMinor = 0;
  if (providerVisible) {
    let count = 0;
    await visitQueryPages(db.collection("sales").where("organizationId", "==", actor.organizationId), page => {
      count += page.length; if (count > 10000) fail("Provider history exceeds the 10,000-invoice limit; no partial activity was returned.");
      for (const sale of page) {
        if (!inside(sale, input) || !hasPermissionScope(financialActor, scopeOf(sale), "expenses.read")) continue;
        const components = sale.get("billing")?.components ?? [];
        for (const component of components) if (component.kind === "provider" && component.supplierId === party.id) {
          providerObligationMinor = safe(providerObligationMinor + safe(component.grossMinor - component.creditedGrossMinor - (component.settledMinor ?? 0)));
          const at = sale.get("recordedAt"); if (at instanceof Timestamp && at.toMillis() >= from && at.toMillis() < through) events.push({ id: `provider:${sale.id}:${component.id}`, at: at.toDate().toISOString(), kind: "Provider funds obligation", reference: sale.get("saleNumber"), amountMinor: component.grossMinor - component.creditedGrossMinor, quantity: null, detail: "Separate provider funds liability; excluded from trade payable and advances", href: `/expenses?saleId=${sale.id}&branchId=${sale.get("branchId")}` });
        }
      }
    }, { pageSize: 100 });
    for (const row of await readRows(actor, "providerFundPayments", party.id)) {
      const at = row.get("paidAt"); if (!inside(row, input) || !hasPermissionScope(financialActor, scopeOf(row), "expenses.read") || !(at instanceof Timestamp) || at.toMillis() < from || at.toMillis() >= through) continue;
      events.push({ id: `providerPayment:${row.id}`, at: at.toDate().toISOString(), kind: "Provider funds payment", reference: row.get("reference") ?? row.id, amountMinor: row.get("amountMinor"), quantity: null, detail: row.get("entryType") === "recovery" ? "Provider funds recovered; separate from trade account" : "Provider funds settled; separate from trade account", href: `/expenses?saleId=${row.get("saleId")}&branchId=${row.get("branchId")}` });
    }
  }
  events.sort((a,b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
  let start = 0; if (input.cursor) { const i = events.findIndex(row => row.id === input.cursor); if (i < 0) throw new HttpsError("invalid-argument", "Restart supplier activity after changing filters."); start = i + 1; }
  const rows = events.slice(start, start + Math.min(input.limit, 100));
  const links = rows.flatMap(row => { const record = accountRecords.get(row.id), type = record?.get("referenceType"), id = record?.get("referenceId"); return typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id) && ["supplierPayment", "supplierReturn"].includes(type) ? [{ row, ref: db.doc(`${type === "supplierPayment" ? "supplierPayments" : "supplierReturns"}/${id}`), type }] : []; });
  if (links.length) {
    const evidence = await db.getAll(...links.map(link => link.ref));
    evidence.forEach((record,index) => { const link = links[index]!; if (!record.exists || record.get("organizationId") !== actor.organizationId || record.get("supplierId") !== party.id || !inside(record, input) || !hasProcurementScope(actor, scopeOf(record), "payables.read")) fail("Linked supplier activity evidence requires reconciliation.");
      if (link.type === "supplierPayment") { link.row.moneyAmountMinor = record.get("direction") === "non_cash" || record.get("source") === "advance_balance" ? null : safe(record.get("amountMinor")); link.row.moneyDirection = record.get("direction") === "inflow" ? "Received by company" : link.row.moneyAmountMinor === null ? "No new money; advance applied" : "Paid by company"; }
      else { link.row.quantity = record.get("quantity"); link.row.stockReference = record.get("inventoryTransactionNumber") ?? record.get("inventoryTransactionId") ?? null; }
    });
  }
  return { rows, nextCursor: start + rows.length < events.length ? rows.at(-1)!.id : null, providerFundsVisible: providerVisible, providerObligationMinor: providerVisible ? providerObligationMinor : null, note: "Goods receipts, orders and financial movements are separate events, not additive charges. Provider funds are not trade AP. Records without verified dates are excluded from this timeline; use the reconciled statement for ledger balances." };
}

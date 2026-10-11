import { AggregateField, FieldPath, Filter, Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { db } from "../admin.js";
import { safeMinor } from "../accounting/daily-close.js";
import { hasRole, hasServerPermission, requireBranchScope, type AccessProfile, type Permission } from "../auth/authorize.js";
import { ceoDateRange, type CeoDashboard, type CeoMetric } from "./ceo-model.js";

export const ceoInput = z.object({
  section: z.literal("ceo"), fromDate: z.iso.date(), toDate: z.iso.date(),
  branchId: z.string().min(1).max(128).optional(), branchCursor: z.string().min(1).max(128).optional(),
  operatingContext: z.object({ type: z.enum(["branch", "warehouse"]), id: z.string().min(1).max(128) }).strict().optional(),
}).strict();
export function canReadCeo(actor: AccessProfile) {
  const organizationScope = (["system_administrator", "operations_administrator", "finance_officer", "auditor"] as const).some(role => hasRole(actor, role));
  return organizationScope && (hasServerPermission(actor, "sales.read.all") ||
    (hasServerPermission(actor, "requests.read.all") && hasServerPermission(actor, "transfers.read.all")));
}

/** Bounded aggregate queries; no business-history documents are sent to the browser. */
export async function loadCeoDashboard(actor: AccessProfile, input: z.infer<typeof ceoInput>): Promise<CeoDashboard> {
  if (!canReadCeo(actor)) throw new HttpsError("permission-denied", "Organization-wide overview access is required.");
  const now = new Date(), today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  let range: ReturnType<typeof ceoDateRange>;
  try { range = ceoDateRange(input.fromDate, input.toDate, today); }
  catch { throw new HttpsError("invalid-argument", "Choose a period of up to 366 days ending today or earlier."); }
  if (input.branchId) {
    requireBranchScope(actor, input.branchId);
    const branch = await db.doc(`branches/${input.branchId}`).get();
    if (!branch.exists || branch.get("organizationId") !== actor.organizationId) throw new HttpsError("not-found", "Branch not found.");
  }
  const result: CeoDashboard = { asOf: now.toISOString(), fromDate: input.fromDate, toDate: input.toDate,
    branchId: input.branchId ?? null, metrics: [], trend: null, comparison: null, branches: [], nextBranchCursor: null, branchError: false, billingConfigured: null };
  const org = (collection: string) => db.collection(collection).where("organizationId", "==", actor.organizationId);
  const scoped = (collection: string) => input.branchId ? org(collection).where("branchId", "==", input.branchId) : org(collection);
  const period = (query: FirebaseFirestore.Query, field: string, start = range.start, end = range.end) => query.where(field, ">=", Timestamp.fromMillis(start)).where(field, "<", Timestamp.fromMillis(Math.min(end, now.getTime() + 1)));
  const sum = async (query: FirebaseFirestore.Query, field: string, integer = true) => {
    const value = (await query.aggregate({ total: AggregateField.sum(field) }).get()).data().total;
    if (integer) return safeMinor(value);
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Invalid quantity.");
    return value;
  };
  const count = async (query: FirebaseFirestore.Query) => safeMinor((await query.count().get()).data().count);
  const pending: Promise<unknown>[] = [];
  const permission = (name: Permission) => hasServerPermission(actor, name);
  const metric = (allowed: boolean, spec: Omit<CeoMetric, "value" | "state">, read: () => Promise<number>) => {
    if (!allowed) return;
    const row: CeoMetric = { ...spec, value: null, state: "unavailable" }; result.metrics.push(row);
    pending.push(read().then(value => { row.value = value; row.state = "ready"; }).catch(() => { /* Remain unavailable, never fabricate zero. */ }));
  };
  const orgSales = permission("sales.read.all"), sales = orgSales && permission("reports.sales.read");
  const salesQuery = scoped("sales");
  const checkout = (query: FirebaseFirestore.Query) => query.where("status", "==", "recorded").where("method", "in", ["cash", "card", "bank_transfer"]);
  metric(sales, { id: "invoiced", label: "Invoiced sales", money: true, basis: "period", href: "/reports", detail: "Gross invoices, including tax and provider funds. Before returns; not earned income or cash." }, () => sum(period(salesQuery, "recordedAt"), "grossAmountMinor"));
  metric(sales, { id: "checkout", label: "Checkout money received", money: true, basis: "period", href: "/reports", detail: "Recorded cash, card and bank receipts at checkout. Gross before refunds; excludes credit, advances applied and unverified payments." }, () => sum(period(checkout(scoped("salePayments")), "recordedAt"), "amountMinor"));
  metric(orgSales && permission("customers.read"), { id: "customerReceipts", label: "Customer repayments & advances", money: true, basis: "period", href: "/customers", detail: "Recorded receipts explicitly marked incoming, including advances. Legacy records without direction, refunds and non-cash applications are excluded; not sales income." }, () => sum(period(scoped("customerPayments").where("direction", "==", "inflow").where("status", "==", "recorded"), "recordedAt"), "amountMinor"));
  metric(orgSales && permission("sales.returns.read"), { id: "serviceReceipts", label: "Service money received", money: true, basis: "period", href: "/aftersales", detail: "Explicit service receipt events, gross before refunds. Legacy records without receipt type, checkout receipts and customer repayments are excluded; not earned income." }, () => sum(period(scoped("aftersalesPayments").where("entryType", "==", "receipt"), "recordedAt"), "amountMinor"));
  metric(sales, { id: "credit", label: "Credit issued at checkout", money: true, basis: "period", href: "/reports", detail: "Credit issued on invoices in this period, before repayments or credits. Not current customer debt." }, () => sum(period(salesQuery, "recordedAt"), "creditAmountMinor"));
  metric(orgSales && permission("customers.read") && !input.branchId, { id: "debt", label: "Customer debt now", money: true, basis: "current", href: "/customers", detail: "Current organization-wide customer balances, including historical debt. Open customer statements for movements." }, () => sum(org("customers"), "outstandingBalanceMinor"));
  metric(orgSales && permission("payables.read"), { id: "payables", label: "Supplier invoices due now", money: true, basis: "current", href: "/procurement", detail: "Outstanding approved supplier invoices; excludes advances and draft/unapproved invoices." }, () => sum(scoped("supplierInvoices").where("status", "in", ["approved", "partially_paid"]), "outstandingAmountMinor"));
  metric(orgSales && permission("expenses.read"), { id: "expenses", label: "Approved expenses still due", money: true, basis: "current", href: "/expenses", detail: "Current approved and partly paid expense obligations. Supplier-linked obligations must not be added to supplier debt." }, () => sum(scoped("expenses").where("status", "in", ["approved", "partially_paid"]), "outstandingAmountMinor"));
  metric(permission("inventory.read"), { id: "emptyStock", label: "Stock rows with none available", money: false, basis: "current", href: "/inventory", detail: "Location/product balance rows with available quantity at or below zero. Reorder thresholds are available in the stock report." }, () => count(scoped("inventoryBalances").where("availableQuantity", "<=", 0)));
  metric(permission("inventory.read"), { id: "reserved", label: "Units reserved", money: false, basis: "current", href: "/inventory", detail: "Current reserved units across balance rows. Not sales or cash." }, () => sum(scoped("inventoryBalances"), "reservedQuantity", false));
  metric(permission("inventory.read"), { id: "onHand", label: "Units on hand now", money: false, basis: "current", href: "/inventory", detail: "Recorded physical units across balance rows, including reserved units. Not a physical stocktake." }, () => sum(scoped("inventoryBalances"), "onHandQuantity", false));
  metric(permission("inventory.read") && permission("inventory.cost.read"), { id: "stockValue", label: "Recorded stock value", money: true, basis: "current", href: "/reports?family=inventory", detail: "Current stored stock cost across balance rows. Unavailable when any row lacks valid nonnegative cost coverage; not a financial statement valuation." }, async () => {
    const query = scoped("inventoryBalances"), [all, covered] = await Promise.all([count(query), count(query.where("totalValueMinor", ">=", 0))]);
    if (all !== covered) throw new Error("Incomplete stock cost coverage.");
    return sum(query, "totalValueMinor");
  });
  metric(permission("requests.read.all"), { id: "requests", label: "Requests awaiting review", money: false, basis: "current", href: "/requests/review", detail: "Submitted requests and requests under review now." }, () => count(scoped("branchRequests").where("status", "in", ["submitted", "under_review"])));
  const transfers = (collection: string) => input.branchId ? org(collection).where(Filter.or(Filter.where("sourceBranchId", "==", input.branchId), Filter.where("destinationBranchId", "==", input.branchId))) : org(collection);
  for (const [id, label, statuses, detail] of [
    ["transfers", "Transfers in transit", ["dispatched", "partially_dispatched"], "Current dispatched movements across the detailed and simple transfer registers. Not sales."],
    ["issues", "Transfer issues", ["disputed", "problem"], "Current discrepancies needing follow-up."],
  ] as const) metric(permission("transfers.read.all"), { id, label, money: false, basis: "current", href: "/transfers", detail }, async () => {
    const values = await Promise.all(["transfers", "stockTransfers"].map(collection => count(transfers(collection).where("status", "in", [...statuses])))); return safeMinor(values[0]! + values[1]!);
  });
  metric(orgSales && permission("procurement.read"), { id: "purchasing", label: "Purchase orders awaiting review", money: false, basis: "current", href: "/procurement", detail: "Submitted purchase orders now; receiving stock is a separate step." }, () => count(scoped("purchaseOrders").where("status", "==", "submitted")));
  metric(orgSales && permission("sales.returns.read"), { id: "service", label: "Open service cases", money: false, basis: "current", href: "/aftersales", detail: "Cases not completed, closed or cancelled. Provider money is a liability, not company income." }, async () => {
    const q = scoped("aftersalesCases"); const [all, closed] = await Promise.all([count(q), count(q.where("status", "in", ["completed", "closed", "cancelled"]))]); return Math.max(0, all - closed);
  });
  metric(permission("hr.read"), { id: "attendance", label: "Recorded clock-ins", money: false, basis: "period", href: "/hr", detail: "Clock-in events, not distinct staff or attendance rate. Manual and imported records; no claim that a device is connected." }, () => count(period(scoped("attendanceEvents").where("kind", "==", "clock_in"), "occurredAt")));
  if (sales) {
    pending.push(Promise.all(range.buckets.map(async bucket => ({ fromDate: bucket.fromDate, toDate: bucket.toDate,
      invoicedMinor: await sum(period(salesQuery, "recordedAt", bucket.start, bucket.end), "grossAmountMinor"),
      checkoutReceiptsMinor: await sum(period(checkout(scoped("salePayments")), "recordedAt", bucket.start, bucket.end), "amountMinor") })))
      .then(rows => { result.trend = rows; }).catch(() => {}));
    pending.push(sum(period(salesQuery, "recordedAt", range.previousStart, range.start), "grossAmountMinor").then(value => {
      result.comparison = { invoicedMinor: value, fromDate: range.previousFromDate, toDate: range.previousToDate };
    }).catch(() => {}));
  }
  if (orgSales && permission("finance.journal.read")) {
    const provider: CeoMetric = { id: "providerFunds", label: "Provider funds owed now", value: null, money: true, basis: "current", href: permission("expenses.read") ? "/expenses#provider-funds" : "/finance", state: "unavailable", detail: "Combined current and historical protected provider-liability ledger balances, including inactive controls. Pass-through funds, not income or an additional expense." };
    result.metrics.push(provider);
    pending.push((async () => {
      const config = await db.doc(`billingConfigurations/${actor.organizationId}`).get();
      result.billingConfigured = Boolean(config.get("mapping"));
      const accounts = await org("chartOfAccounts").where("billingControlPurpose", "==", "provider_payable").limit(21).get();
      if (accounts.size > 20) throw new Error("Open the full provider ledger for this many control accounts.");
      if (!accounts.size) { provider.state = result.billingConfigured ? "unavailable" : "not_configured"; return; }
      const balances = await Promise.all(accounts.docs.map(async account => {
        const lines = scoped("journalLines").where("accountId", "==", account.id);
        const [credit, debit] = await Promise.all([sum(lines, "creditMinor"), sum(lines, "debitMinor")]);
        return safeMinor(credit - debit);
      }));
      provider.value = safeMinor(balances.reduce((total, value) => safeMinor(total + value), 0)); provider.state = "ready";
    })().catch(() => {}));
  }
  pending.push((async () => {
    let q: FirebaseFirestore.Query = org("branches").orderBy(FieldPath.documentId());
    if (input.branchCursor) {
      const cursor = await db.doc(`branches/${input.branchCursor}`).get();
      if (!cursor.exists || cursor.get("organizationId") !== actor.organizationId) throw new Error("Invalid branch page.");
      q = q.startAfter(cursor);
    }
    const page = await q.limit(7).get();
    result.nextBranchCursor = page.size > 6 ? page.docs[5]!.id : null;
    result.branches = await Promise.all(page.docs.slice(0, 6).map(async branch => {
      let invoicedMinor: number | null = null;
      if (sales) try { invoicedMinor = await sum(period(org("sales").where("branchId", "==", branch.id), "recordedAt"), "grossAmountMinor"); } catch { /* Unavailable is explicit. */ }
      return { id: branch.id, name: String(branch.get("name") ?? branch.id), invoicedMinor };
    }));
  })().catch(() => { result.branchError = true; }));
  await Promise.all(pending);
  return result;
}

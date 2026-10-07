import { AggregateField, Filter, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";
import { db } from "../admin.js";
import { dailyBounds, safeMinor } from "../accounting/daily-close.js";
import { hasServerPermission, requireAccess, requireBranchScope, requireWarehouseScope } from "../auth/authorize.js";
import { enforceAppCheck } from "../config.js";
import { pipelineStages, type DashboardWorkspace } from "../dashboard/model.js";
import { parseInput } from "../utils/callable.js";

const inputSchema = z.object({ branchId: z.string().min(1).max(128).optional(), warehouseId: z.string().min(1).max(128).optional(), section: z.enum(["all", "operations", "sales"]).default("all") })
  .refine((input) => !(input.branchId && input.warehouseId), "Select one operating location.");
async function count(query: FirebaseFirestore.Query) { return safeMinor((await query.count().get()).data().count); }
async function active(query: FirebaseFirestore.Query, terminal: string[]) {
  const [all, ended] = await Promise.all([count(query), count(query.where("status", "in", terminal))]);
  return Math.max(0, all - ended);
}
function scopedTransfer(query: FirebaseFirestore.Query, branchId: string | undefined, warehouseId: string | undefined, simple: boolean) {
  if (branchId) return query.where(Filter.or(Filter.where("destinationBranchId", "==", branchId), Filter.where("sourceBranchId", "==", branchId)));
  if (warehouseId) return query.where(simple ? "sourceWarehouseId" : "originWarehouseId", "==", warehouseId);
  return query;
}

/** Index-backed sums/counts only: dashboard payload size does not grow with business history. */
export const getDashboardWorkspace = onCall({ enforceAppCheck, timeoutSeconds: 120 }, async (request) => {
  const actor = await requireAccess(request);
  const input = parseInput(inputSchema, request.data);
  if (input.branchId) {
    requireBranchScope(actor, input.branchId);
    const branch = await db.doc(`branches/${input.branchId}`).get();
    if (!branch.exists || branch.get("organizationId") !== actor.organizationId) throw new HttpsError("not-found", "Store not found.");
  }
  if (input.warehouseId) {
    requireWarehouseScope(actor, input.warehouseId);
    const location = await db.doc(`warehouses/${input.warehouseId}`).get();
    if (!location.exists || location.get("organizationId") !== actor.organizationId) throw new HttpsError("not-found", "Stock location not found.");
  }
  const now = new Date();
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const today = dailyBounds(date).start;
  const from = Timestamp.fromMillis(today.toMillis() - 29 * 86_400_000);
  const organizationQuery = (collection: string) => db.collection(collection).where("organizationId", "==", actor.organizationId);
  const result: DashboardWorkspace = { asOf: now.toISOString(), fromDate: new Date(from.toMillis() + 3_600_000).toISOString().slice(0, 10), toDate: date,
    summary: { requests: null, transfers: null, products: null, discrepancies: null }, pipeline: [], sales: null, trend: [], paymentMix: [] };
  const work: Promise<unknown>[] = [];
  if (input.section !== "sales" && hasServerPermission(actor, "products.read")) work.push(count(organizationQuery("products").where("active", "==", true)).then((value) => { result.summary.products = value; }));
  const requestBranch = input.branchId ?? (!hasServerPermission(actor, "requests.read.all") && actor.branchIds.length === 1 ? actor.branchIds[0] : undefined);
  if (input.section !== "sales" && (hasServerPermission(actor, "requests.read.all") || (hasServerPermission(actor, "requests.read.own_branch") && requestBranch))) {
    let query: FirebaseFirestore.Query = organizationQuery("branchRequests");
    if (requestBranch) { requireBranchScope(actor, requestBranch); query = query.where("branchId", "==", requestBranch); }
    work.push(active(query, ["fulfilled", "cancelled", "closed", "rejected"]).then((value) => { result.summary.requests = value; }));
  }
  const orgTransfers = hasServerPermission(actor, "transfers.read.all");
  const transferBranch = input.branchId ?? (!orgTransfers && !input.warehouseId && actor.branchIds.length === 1 ? actor.branchIds[0] : undefined);
  const transferWarehouse = input.warehouseId ?? (!orgTransfers && !transferBranch && actor.warehouseIds.length === 1 ? actor.warehouseIds[0] : undefined);
  const mayReadScopedTransfers = (transferBranch && hasServerPermission(actor, "transfers.read.own_branch")) || (transferWarehouse && hasServerPermission(actor, "transfers.read.assigned_warehouse"));
  if (input.section !== "sales" && (orgTransfers || mayReadScopedTransfers)) {
    if (transferBranch) requireBranchScope(actor, transferBranch);
    if (transferWarehouse) requireWarehouseScope(actor, transferWarehouse);
    const queries = ["transfers", "stockTransfers"].map((collection) => scopedTransfer(organizationQuery(collection), transferBranch, transferWarehouse, collection === "stockTransfers"));
    work.push(Promise.all(queries.map((query) => active(query, ["closed", "cancelled", "completed"]))).then((values) => { result.summary.transfers = values.reduce((sum, value) => sum + value, 0); }));
    work.push(Promise.all(queries.map((query) => count(query.where("status", "in", ["disputed", "problem"])))).then((values) => { result.summary.discrepancies = values.reduce((sum, value) => sum + value, 0); }));
    work.push(Promise.all(Object.entries(pipelineStages).map(async ([label, statuses]) => {
      const values = await Promise.all(queries.map((query) => count(query.where("status", "in", statuses))));
      return { label, value: values.reduce((sum, value) => sum + value, 0) };
    })).then((values) => { result.pipeline = values; }));
  }
  const orgSales = hasServerPermission(actor, "sales.read.all");
  const salesBranch = input.branchId ?? (!orgSales && actor.branchIds.length === 1 ? actor.branchIds[0] : undefined);
  if (input.section !== "operations" && !input.warehouseId && hasServerPermission(actor, "reports.sales.read") && (orgSales || salesBranch)) {
    let query: FirebaseFirestore.Query = organizationQuery("sales");
    if (salesBranch) { requireBranchScope(actor, salesBranch); query = query.where("branchId", "==", salesBranch); }
    const base = query.where("recordedAt", ">=", from).where("recordedAt", "<=", Timestamp.fromDate(now));
    work.push(Promise.all([count(base), base.aggregate({ grossAmountMinor: AggregateField.sum("grossAmountMinor"), amountPaidMinor: AggregateField.sum("amountPaidMinor"), creditAmountMinor: AggregateField.sum("creditAmountMinor") }).get()])
      .then(([saleCount, totals]) => { const data = totals.data(); result.sales = { saleCount, grossAmountMinor: safeMinor(data.grossAmountMinor), amountPaidMinor: safeMinor(data.amountPaidMinor), creditAmountMinor: safeMinor(data.creditAmountMinor) }; }));
    work.push(Promise.all(Array.from({ length: 7 }, async (_, index) => {
      const day = Timestamp.fromMillis(today.toMillis() - (6 - index) * 86_400_000);
      const end = Timestamp.fromMillis(Math.min(day.toMillis() + 86_400_000, now.getTime() + 1));
      const dayQuery = query.where("recordedAt", ">=", day).where("recordedAt", "<", end);
      const [sales, totals] = await Promise.all([count(dayQuery), dayQuery.aggregate({ grossAmountMinor: AggregateField.sum("grossAmountMinor"), amountPaidMinor: AggregateField.sum("amountPaidMinor"), creditAmountMinor: AggregateField.sum("creditAmountMinor") }).get()]);
      return { date: new Date(day.toMillis() + 3_600_000).toISOString().slice(0, 10), label: new Intl.DateTimeFormat("en-NG", { timeZone: "Africa/Lagos", weekday: "short" }).format(day.toDate()), value: safeMinor(totals.data().grossAmountMinor), count: sales };
    })).then((values) => { result.trend = values; }));
    work.push(Promise.all([
      count(base.where("paymentStatus", "in", ["recorded", "awaiting_verification", "paid"])),
      count(base.where("paymentStatus", "==", "partially_paid")), count(base.where("paymentStatus", "==", "credit")),
    ]).then((values) => { result.paymentMix = [
      { label: "Paid in full", value: values[0]!, color: "#34458f" }, { label: "Part-paid", value: values[1]!, color: "#f6b333" }, { label: "On credit", value: values[2]!, color: "#c8563d" },
    ]; }));
  }
  await Promise.all(work);
  return result;
});

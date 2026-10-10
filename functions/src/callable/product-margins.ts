import { Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";
import { db } from "../admin.js";
import { hasServerPermission, requireAccess, requireBranchScope, requirePermission } from "../auth/authorize.js";
import { enforceAppCheck } from "../config.js";
import { parseInput } from "../utils/callable.js";
import { visitQueryPages } from "../utils/query-pages.js";
import { addProductMargin, type MarginItem, type MarginReturn, type ProductMargin } from "../reports/product-margins.js";
const inputSchema = z.object({ branchId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional(), fromDate: z.iso.date(), toDate: z.iso.date() })
  .refine(input => input.fromDate <= input.toDate, { message: "The end date cannot precede the start date.", path: ["toDate"] });
export const getProductMargins = onCall({ enforceAppCheck, timeoutSeconds: 300 }, async request => {
  const actor = await requireAccess(request); requirePermission(actor, "reports.sales.read"); requirePermission(actor, "inventory.cost.read");
  const input = parseInput(inputSchema, request.data);
  let branchId = input.branchId;
  if (!hasServerPermission(actor, "sales.read.all")) {
    branchId ??= actor.branchIds.length === 1 ? actor.branchIds[0] : undefined;
    if (!branchId) throw new HttpsError("invalid-argument", "Select an assigned store for product margins.");
  }
  if (branchId) requireBranchScope(actor, branchId);
  const startedAt = new Date().toISOString();
  let sales: FirebaseFirestore.Query = db.collection("sales").where("organizationId", "==", actor.organizationId)
    .where("recordedAt", ">=", Timestamp.fromDate(new Date(`${input.fromDate}T00:00:00+01:00`)))
    .where("recordedAt", "<", Timestamp.fromMillis(Date.parse(`${input.toDate}T00:00:00+01:00`) + 86_400_000));
  if (branchId) sales = sales.where("branchId", "==", branchId);
  const totals = new Map<string, ProductMargin>(); let invoiceCount = 0;
  const providerFunds = { originalMinor: 0, creditedMinor: 0, netMinor: 0 };
  try {
    await visitQueryPages(sales, async docs => {
      // Bound concurrency and page memory; no fixed invoice limit silently truncates a range.
      for (const sale of docs) {
        invoiceCount++;
        for (const component of sale.get("billing.components") ?? []) if (component.kind === "provider") { providerFunds.originalMinor += component.grossMinor; providerFunds.creditedMinor += component.creditedGrossMinor; providerFunds.netMinor = providerFunds.originalMinor - providerFunds.creditedMinor; if (![providerFunds.originalMinor, providerFunds.creditedMinor, providerFunds.netMinor].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error("Provider report evidence requires reconciliation."); }
        const [items, returns, returnItems] = await Promise.all([
          db.collection("saleItems").where("saleId", "==", sale.id).get(),
          db.collection("saleReturns").where("saleId", "==", sale.id).get(),
          db.collection("saleReturnItems").where("saleId", "==", sale.id).get(),
        ]);
        if (items.empty) throw new Error("An invoice has no item evidence. Reconcile it before reporting product margins.");
        const approved = new Map(returns.docs.filter(doc => doc.get("organizationId") === actor.organizationId && doc.get("status") === "approved").map(doc => [doc.id, doc]));
        const reversed = new Map<string, MarginReturn[]>();
        for (const doc of returnItems.docs) {
          const parent = approved.get(doc.get("returnId")); if (!parent) continue;
          if (doc.get("organizationId") !== actor.organizationId) throw new Error("Return evidence belongs to a different organization.");
          const line: MarginReturn = { saleItemId: doc.get("saleItemId"), quantity: doc.get("quantity"), netAmountMinor: doc.get("netAmountMinor"), costAmountMinor: doc.get("costAmountMinor"), restockable: doc.get("condition") === "restockable", cancellation: parent.get("kind") === "reservation_cancellation" };
          reversed.set(line.saleItemId, [...(reversed.get(line.saleItemId) ?? []), line]);
        }
        for (const doc of items.docs) {
          if (doc.get("organizationId") !== actor.organizationId) throw new Error("Invoice item evidence belongs to a different organization.");
          const provider = (sale.get("billing.components") ?? []).find((component: { id: string }) => component.id === `provider:${doc.id}`);
          const item: MarginItem = { providerOriginalMinor: provider?.grossMinor ?? 0, providerCreditedMinor: provider?.creditedGrossMinor ?? 0, itemKind: doc.get("itemKind") === "service" ? "service" : "goods", id: doc.id, productId: doc.get("productId"), sku: doc.get("sku") ?? "", productName: doc.get("productName") ?? "Historical product", quantity: doc.get("quantity"), netAmountMinor: doc.get("netAmountMinor"), costAmountMinor: doc.get("costAmountMinor"), costEvidenceComplete: !returnItems.docs.some(line => line.get("saleItemId") === doc.id && approved.has(line.get("returnId")) && ["repair", "warranty"].includes(line.get("disposition"))), collectionTracked: doc.get("collectionTracked"), collectedQuantity: doc.get("collectedQuantity"), cancelledQuantity: doc.get("cancelledQuantity") };
          addProductMargin(totals, item, reversed.get(doc.id) ?? []);
        }
        if (totals.size > 2000) throw new Error("This range contains more than 2,000 products. Choose a shorter range; no partial totals were returned.");
      }
    }, { orderField: "recordedAt", pageSize: 100 });
  } catch (cause) {
    if (cause instanceof HttpsError) throw cause;
    if (cause instanceof Error && !('code' in cause)) throw new HttpsError("failed-precondition", cause.message);
    throw cause;
  }
  return { providerFunds, rows: [...totals.values()].sort((a, b) => a.sku.localeCompare(b.sku) || a.productId.localeCompare(b.productId)), invoiceCount, startedAt, completedAt: new Date().toISOString(), branchId: branchId ?? null };
});

import { Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import { hasRole, hasServerPermission, requireAccess, requireBranchScope, requirePermission, type AccessProfile } from "../auth/authorize.js";
import { enforceAppCheck } from "../config.js";
import { parseInput } from "../utils/callable.js";
import { visitQueryPages } from "../utils/query-pages.js";
import { calendarDays, productPerformanceInput } from "../validation/product-performance.js";
import { addMovementEntry, customerMovementTypes, emptyMovementRow, type MovementEvidence, type MovementRow } from "../reports/product-movement.js";

/** Mirrors existing inventory Store read authority, including selected mixed-role context. */
export function movementStoreScope(actor: AccessProfile, requested?: string) {
  const broad = ["system_administrator", "operations_administrator", "finance_officer", "auditor"].some(role => hasRole(actor, role as Parameters<typeof hasRole>[1]));
  if (broad) return requested;
  if (!hasRole(actor, "branch_manager") || actor.warehouseIds.length || !actor.branchIds.length) throw new HttpsError("permission-denied", "Customer movement requires an assigned Store inventory context.");
  const branch = requested ?? (actor.branchIds.length === 1 ? actor.branchIds[0] : undefined);
  if (!branch) throw new HttpsError("invalid-argument", "Select an assigned Store.");
  requireBranchScope(actor, branch); return branch;
}
const evidence = (doc: FirebaseFirestore.DocumentSnapshot): MovementEvidence | undefined => doc.exists ? { ...doc.data(), id: doc.id } : undefined;
export const getProductMovement = onCall({ enforceAppCheck, timeoutSeconds: 300 }, async request => {
  const actor = await requireAccess(request); requirePermission(actor, "reports.inventory.read"); requirePermission(actor, "inventory.read");
  const input = parseInput(productPerformanceInput, request.data), branchId = movementStoreScope(actor, input.branchId);
  const zeroPopulationIncluded = hasServerPermission(actor, "products.read");
  const startedAt = new Date().toISOString(), rows = new Map<string, MovementRow>();
  let scannedEntries = 0, unresolvedEntries = 0, scannedBalances = 0;
  const selected = (id: string) => !input.productId || input.productId === id;
  const ensure = (id: string, name: string, sku: string) => {
    if (!rows.has(id)) rows.set(id, emptyMovementRow(id, name, sku));
    if (rows.size > 2000) throw new HttpsError("resource-exhausted", "More than 2,000 products match. Select a product or shorter period; no partial rankings were returned.");
    return rows.get(id)!;
  };
  let query: FirebaseFirestore.Query = db.collection("inventoryEntries").where("organizationId", "==", actor.organizationId)
    .where("effectiveAt", ">=", Timestamp.fromDate(new Date(`${input.fromDate}T00:00:00+01:00`)))
    .where("effectiveAt", "<", Timestamp.fromMillis(Date.parse(`${input.toDate}T00:00:00+01:00`) + 86_400_000)).orderBy("effectiveAt", "desc");
  if (branchId) query = query.where("branchId", "==", branchId);
  try {
    await visitQueryPages(query, async docs => {
      scannedEntries += docs.length;
      if (scannedEntries > 100000) throw new HttpsError("resource-exhausted", "More than 100,000 inventory entries in this scope. Choose a shorter period; no partial rankings were returned.");
      const entries = docs.filter(doc => doc.get("locationId") && !doc.get("externalAccount") && doc.get("branchId") && selected(String(doc.get("productId"))) && [...customerMovementTypes, "reversal"].includes(doc.get("transactionType")));
      const ids = [...new Set(entries.map(doc => doc.get("transactionId")).filter((id): id is string => typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id)))];
      const parents = new Map<string, MovementEvidence>();
      if (ids.length) for (const doc of await db.getAll(...ids.map(id => db.doc(`inventoryTransactions/${id}`)))) {
        if (doc.get("organizationId") === actor.organizationId) parents.set(doc.id, evidence(doc)!);
      }
      for (const doc of entries) {
        const id = doc.get("productId");
        if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) { unresolvedEntries++; continue; }
        const row = ensure(id, doc.get("productName") ?? "Historical product", doc.get("sku") ?? "");
        const entry = evidence(doc)!, parent = parents.get(String(entry.transactionId));
        let original: MovementEvidence | undefined, originalQuantity: number | undefined;
        if (entry.transactionType === "reversal" && typeof parent?.reversalOfTransactionId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(parent.reversalOfTransactionId)) {
          const origin = await db.doc(`inventoryTransactions/${parent.reversalOfTransactionId}`).get();
          if (origin.get("organizationId") === actor.organizationId) original = evidence(origin);
          if (original && customerMovementTypes.includes(String(original.transactionType))) {
            const originals = await db.collection("inventoryEntries").where("transactionId", "==", original.id).limit(1001).get();
            const matches = originals.docs.filter(d => d.get("organizationId") === actor.organizationId && d.get("productId") === id && d.get("locationId") === entry.locationId && d.get("branchId") === entry.branchId && !d.get("externalAccount") && (d.get("serializedItemId") ?? null) === (entry.serializedItemId ?? null) && (d.get("lotId") ?? null) === (entry.lotId ?? null));
            if (originals.size <= 1000 && matches.length === 1) originalQuantity = matches[0]!.get("quantityDelta");
            // The legacy reversal writer does not copy included-part attribution.
            if (matches.some(d => d.get("partsMode") === "included")) originalQuantity = undefined;
          }
        }
        addMovementEntry(row, entry, parent, original, originalQuantity);
      }
    }, { orderDirection: "desc", pageSize: 250 });
    // Zero-handover population is active goods with a current local balance,
    // including zero balances. No global catalogue permission is inferred.
    const balances = new Map<string, number>();
    let balanceQuery: FirebaseFirestore.Query = db.collection("inventoryBalances").where("organizationId", "==", actor.organizationId);
    if (branchId) balanceQuery = balanceQuery.where("branchId", "==", branchId);
    await visitQueryPages(balanceQuery.select("productId", "branchId", "locationId", "onHandQuantity"), docs => {
      scannedBalances += docs.length;
      if (scannedBalances > 100000) throw new HttpsError("resource-exhausted", "More than 100,000 current balances; no partial report was returned.");
      for (const doc of docs) {
        const id = doc.get("productId"), amount = doc.get("onHandQuantity");
        if (!doc.get("branchId") || !doc.get("locationId") || typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id) || !selected(id)) continue;
        if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("Current stock evidence requires reconciliation.");
        const total = (balances.get(id) ?? 0) + amount;
        if (!Number.isSafeInteger(total)) throw new Error("Current stock quantity exceeds safe integers.");
        balances.set(id, total);
        if (balances.size > 2000) throw new HttpsError("resource-exhausted", "More than 2,000 local products. Select a product; no partial rankings were returned.");
      }
    });
    // Project only the public item labels already available through inventory.
    const productIds = zeroPopulationIncluded ? [...balances.keys()] : [];
    for (let i = 0; i < productIds.length; i += 100) for (const product of await db.getAll(...productIds.slice(i, i + 100).map(id => db.doc(`products/${id}`)))) {
      if (product.get("organizationId") !== actor.organizationId || product.get("active") !== true || product.get("itemKind") === "service") continue;
      const row = ensure(product.id, product.get("name") ?? "Product", product.get("sku") ?? "");
      row.activeLocalGoods = true; row.currentOnHandQuantity = balances.get(product.id)!; row.unitOfMeasure = product.get("unitOfMeasure") ?? "Unit not recorded";
    }
  } catch (cause) {
    if (cause instanceof HttpsError) throw cause;
    if (cause instanceof Error && !("code" in cause)) throw new HttpsError("failed-precondition", cause.message);
    throw cause;
  }
  return { rows: [...rows.values()].filter(row => row.activeLocalGoods || row.entryCount || row.unknownEntryCount).sort((a, b) => a.sku.localeCompare(b.sku) || a.productId.localeCompare(b.productId)), fromDate: input.fromDate, toDate: input.toDate, branchId: branchId ?? null, productId: input.productId ?? null, calendarDays: calendarDays(input.fromDate, input.toDate), scannedEntries, unresolvedEntries, zeroPopulationIncluded, population: zeroPopulationIncluded ? "Active goods with a current Store balance (including zero), plus historical customer activity. Not the entire catalogue; stock is current, not period-end." : "Historical customer activity only. Current catalogue/zero-handover population requires existing products.read authority.", startedAt, completedAt: new Date().toISOString() };
});

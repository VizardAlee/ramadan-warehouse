import { randomUUID } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../admin.js";
import { uniquenessDocumentId } from "../inventory/calculations.js";
import { calculateFastMoving, emptyFastMoving, FAST_MOVING_WINDOW_MS, type FastMovingResult, type FastMovingSale, type FastMovingItem, type FastMovingCounter, type FastMovingProduct } from "./pos-fast-moving.js";

let refreshInProgress = false;
function cachedResult(current: FirebaseFirestore.DocumentSnapshot, organizationId: string, branchId: string, now: number): FastMovingResult | null {
  const result = current.get("result");
  if (current.get("organizationId") !== organizationId || current.get("branchId") !== branchId || current.get("version") !== 1 ||
    result?.version !== 1 || result.branchId !== branchId || !["ready", "insufficient_history", "unavailable", "refreshing"].includes(result.status) ||
    !Array.isArray(result.productIds) || result.productIds.length > 5000 || !result.productIds.every((id: unknown) => typeof id === "string") ||
    !Number.isFinite(Date.parse(result.asOf)) || !(Date.parse(result.expiresAt) > now)) return null;
  // Project an explicit allowlist even if future cache writers add private diagnostics.
  return { version: 1, branchId, status: result.status, productIds: result.productIds, asOf: result.asOf, expiresAt: result.expiresAt };
}

/** Bounded lazy materialization. Warm reads never wait for a cold branch refresh. */
export async function readPosFastMoving(organizationId: string, branchId: string): Promise<FastMovingResult> {
  const now = Date.now(), token = randomUUID();
  const cache = db.doc(`posFastMovingSummaries/${uniquenessDocumentId(organizationId, "posFastMoving", branchId)}`);
  const warm = cachedResult(await cache.get(), organizationId, branchId, now);
  if (warm) return warm;
  if (refreshInProgress) return emptyFastMoving(branchId, now, "refreshing");
  refreshInProgress = true;
  try {
    return await refreshBranch();
  } finally { refreshInProgress = false; }

  async function refreshBranch(): Promise<FastMovingResult> {
    const claim = await db.runTransaction(async tx => {
      const current = await tx.get(cache);
      const matches = current.get("organizationId") === organizationId && current.get("branchId") === branchId && current.get("version") === 1;
      const ready = cachedResult(current, organizationId, branchId, now);
      if (ready) return ready;
      if (matches && Number(current.get("leaseUntil")) > now) return emptyFastMoving(branchId, now, "refreshing");
      tx.set(cache, { organizationId, branchId, version: 1, token, leaseUntil: now + 90_000 });
      return null;
    });
    if (claim) return claim;
    let result: FastMovingResult;
    try {
      const sales = await db.collection("sales").select("organizationId", "branchId", "status", "recordedAt", "itemCount").where("organizationId", "==", organizationId).where("branchId", "==", branchId)
        .where("recordedAt", ">=", Timestamp.fromMillis(now - FAST_MOVING_WINDOW_MS)).where("recordedAt", "<=", Timestamp.fromMillis(now))
        .orderBy("recordedAt", "desc").limit(1001).get();
      if (sales.size > 1000) throw Error("Window exceeds bounded summary capacity");
      if (Date.now() - now > 20_000) throw Error("Refresh deadline");
      const completed = sales.docs.filter(s => s.get("status") === "completed");
      const items: FastMovingItem[] = [];
      // Each confirmed receipt has <=50 lines. No per-open unbounded scan or N+1 reads.
      for (let offset = 0; offset < completed.length; offset += 30) {
        if (Date.now() - now > 20_000) throw Error("Refresh deadline");
        const page = await db.collection("saleItems").select("organizationId", "branchId", "saleId", "productId", "quantity", "unitOfMeasure", "itemKind", "cancelledQuantity").where("saleId", "in", completed.slice(offset, offset + 30).map(s => s.id)).limit(1501).get();
        if (page.size > 1500 || items.length + page.size > 5000) throw Error("Line window exceeds bounded summary capacity");
        items.push(...page.docs.map(d => ({ ...d.data(), id: d.id }) as FastMovingItem));
      }
      const counters = new Map<string, FastMovingCounter>(), products: FastMovingProduct[] = [];
      for (let offset = 0; offset < items.length; offset += 100) {
        if (Date.now() - now > 20_000) throw Error("Refresh deadline");
        const group = items.slice(offset, offset + 100);
        const docs = await db.getAll(...group.map(i => db.doc(`saleReturnItemCounters/${uniquenessDocumentId(organizationId, "saleReturnItem", i.id)}`)), { fieldMask: ["organizationId", "saleId", "saleItemId", "returnedQuantity"] });
        docs.forEach((d, index) => { if (d.exists) counters.set(group[index]!.id, d.data() as FastMovingCounter); });
      }
      const ids = [...new Set(items.map(i => i.productId))];
      if (ids.some(id => typeof id !== "string" || !id || id.includes("/"))) throw Error("Invalid product evidence");
      for (let offset = 0; offset < ids.length; offset += 100) {
        if (Date.now() - now > 20_000) throw Error("Refresh deadline");
        const docs = await db.getAll(...ids.slice(offset, offset + 100).map(id => db.doc(`products/${id}`)), { fieldMask: ["organizationId", "active", "unitOfMeasure", "itemKind", "trackingType"] });
        products.push(...docs.filter(d => d.exists).map(d => ({ ...d.data(), id: d.id }) as FastMovingProduct));
      }
      result = calculateFastMoving(organizationId, branchId, now, completed.map(d => ({ ...d.data(), id: d.id, recordedAt: d.get("recordedAt") instanceof Timestamp ? d.get("recordedAt").toDate().toISOString() : "" }) as FastMovingSale), items, counters, products);
    } catch {
      // POS remains usable; never publish a truncated or guessed ranking.
      result = emptyFastMoving(branchId, now, "unavailable");
    }
    await db.runTransaction(async tx => {
      const current = await tx.get(cache);
      if (current.get("token") === token) tx.update(cache, { result, leaseUntil: 0 });
    });
    return result;
  }
}

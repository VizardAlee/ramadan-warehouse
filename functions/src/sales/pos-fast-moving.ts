/** POS-safe purchase frequency, never revenue, cost or margin. */
export const FAST_MOVING_VERSION = 1;
export const FAST_MOVING_WINDOW_MS = 30 * 86_400_000;
export interface FastMovingResult {
  version: 1;
  branchId: string;
  status: "ready" | "insufficient_history" | "unavailable" | "refreshing";
  productIds: string[];
  asOf: string;
  expiresAt: string;
}
export interface FastMovingSale { id: string; organizationId: string; branchId: string; status: string; recordedAt: string; itemCount: number }
export interface FastMovingItem { id: string; organizationId: string; branchId: string; saleId: string; productId: string; quantity: number; unitOfMeasure: string; itemKind?: string; cancelledQuantity?: number }
export interface FastMovingCounter { organizationId: string; saleId: string; saleItemId: string; returnedQuantity?: number }
export interface FastMovingProduct { id: string; organizationId: string; unitOfMeasure: string; itemKind?: string; trackingType?: string; active: boolean }
export function emptyFastMoving(branchId: string, now: number, status: FastMovingResult["status"]): FastMovingResult {
  return { version: 1, branchId, status, productIds: [], asOf: new Date(now).toISOString(), expiresAt: new Date(now + (status === "unavailable" || status === "refreshing" ? 60_000 : 15 * 60_000)).toISOString() };
}
const day = (date: string) => new Date(Date.parse(date) + 3_600_000).toISOString().slice(0, 10);
const quantity = (n: unknown) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
/** Inputs must cover the entire bounded window; the loader rejects truncation. */
export function calculateFastMoving(organizationId: string, branchId: string, now: number,
  sales: FastMovingSale[], items: FastMovingItem[], counters: Map<string, FastMovingCounter>, products: FastMovingProduct[]): FastMovingResult {
  const result = emptyFastMoving(branchId, now, "insufficient_history");
  const selected = sales.filter(s => s.organizationId === organizationId && s.branchId === branchId && s.status === "completed" && Date.parse(s.recordedAt) >= now - FAST_MOVING_WINDOW_MS && Date.parse(s.recordedAt) <= now);
  const bySale = new Map(selected.map(s => [s.id, s]));
  const byProduct = new Map(products.filter(p => p.organizationId === organizationId && p.active && p.itemKind !== "service" && ["quantity", "serial"].includes(p.trackingType ?? "")).map(p => [p.id, p]));
  const grouped = new Map<string, FastMovingItem[]>();
  for (const item of items) {
    if (!bySale.has(item.saleId)) continue;
    if (item.organizationId !== organizationId || item.branchId !== branchId) return emptyFastMoving(branchId, now, "unavailable");
    const group = grouped.get(item.saleId) ?? []; group.push(item); grouped.set(item.saleId, group);
  }
  const activity = new Map<string, Map<string, string>>(), excluded = new Set<string>();
  const branchReceipts = new Set<string>(), branchDays = new Set<string>();
  for (const sale of selected) {
    const lines = grouped.get(sale.id) ?? [];
    if (!Number.isSafeInteger(sale.itemCount) || sale.itemCount < 1 || lines.length !== sale.itemCount || new Set(lines.map(l => l.id)).size !== lines.length) return emptyFastMoving(branchId, now, "unavailable");
    for (const line of lines) {
      if (line.itemKind === "service") continue;
      const counter = counters.get(line.id);
      if (counter && (counter.organizationId !== organizationId || counter.saleId !== sale.id || counter.saleItemId !== line.id)) return emptyFastMoving(branchId, now, "unavailable");
      const returned = counter?.returnedQuantity ?? 0, cancelled = line.cancelledQuantity ?? 0;
      if (!quantity(line.quantity) || line.quantity === 0 || !quantity(returned) || !quantity(cancelled) || returned + cancelled > line.quantity) return emptyFastMoving(branchId, now, "unavailable");
      const product = byProduct.get(line.productId);
      // No historical conversion model exists. Never guess a pack/unit ratio.
      if (!product || !line.unitOfMeasure || line.unitOfMeasure !== product.unitOfMeasure) { excluded.add(line.productId); continue; }
      if (line.quantity - returned - cancelled <= 0) continue;
      const receipts = activity.get(line.productId) ?? new Map<string, string>();
      receipts.set(sale.id, day(sale.recordedAt)); activity.set(line.productId, receipts);
      branchReceipts.add(sale.id); branchDays.add(day(sale.recordedAt));
    }
  }
  if (branchReceipts.size < 10 || branchDays.size < 3) return result;
  const population = [...activity].filter(([id]) => !excluded.has(id));
  const sorted = population.map(([id, receipts]) => ({ id, frequency: receipts.size, days: new Set(receipts.values()).size })).sort((a, b) => b.frequency - a.frequency || a.id.localeCompare(b.id));
  const cutoff = sorted[Math.max(0, Math.ceil(sorted.length * 0.2) - 1)]?.frequency ?? Infinity;
  result.status = "ready";
  result.productIds = sorted.filter(p => p.frequency >= cutoff && p.frequency >= 5 && p.days >= 3).map(p => p.id);
  return result;
}

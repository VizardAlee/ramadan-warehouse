import { describe, expect, it } from "vitest";
import { calculateFastMoving, FAST_MOVING_WINDOW_MS, type FastMovingSale, type FastMovingItem, type FastMovingCounter } from "../functions/src/sales/pos-fast-moving";
const now = Date.parse("2026-10-20T12:00:00Z"), org = "org", branch = "branch";
const product = (id: string, unitOfMeasure = "unit") => ({ id, organizationId: org, unitOfMeasure, trackingType: "quantity", active: true });
function fixture() {
  const sales: FastMovingSale[] = [], items: FastMovingItem[] = [];
  for (let n = 0; n < 20; n++) {
    const id = `sale${n}`;
    sales.push({ id, organizationId: org, branchId: branch, status: "completed", recordedAt: new Date(now - (n % 6 + 1) * 86_400_000).toISOString(), itemCount: 1 });
    items.push({ id: `line${n}`, organizationId: org, branchId: branch, saleId: id, productId: n < 8 ? "popular" : `other${n % 4}`, quantity: 10, unitOfMeasure: "unit" });
  }
  return { sales, items, counters: new Map<string, FastMovingCounter>(), products: [product("popular"), ...Array.from({ length: 4 }, (_, i) => product(`other${i}`))] };
}
function run(f = fixture()) { return calculateFastMoving(org, branch, now, f.sales, f.items, f.counters, f.products); }
describe("POS fast-moving completed purchase frequency", () => {
  it("uses repeat receipts, not quantities, revenue, transfers or manual flags", () => {
    const f = fixture(); f.items[19]!.quantity = 1_000_000;
    expect(run(f)).toMatchObject({ status: "ready", productIds: ["popular"] });
    expect(Object.keys(run(f)).sort()).toEqual(["version", "branchId", "status", "productIds", "asOf", "expiresAt"].sort());
  });
  it("deduplicates repeated product lines on one receipt", () => {
    const f = fixture(); const line = { ...f.items[0]!, id: "extra" }; f.items.push(line); f.sales[0]!.itemCount++;
    expect(run(f).productIds).toEqual(["popular"]);
    f.sales = [f.sales[0]!]; f.items = [f.items[0]!, line];
    expect(run(f)).toMatchObject({ status: "insufficient_history", productIds: [] });
  });
  it.each(["draft", "cancelled", "order_received", "payment_accepted"])("excludes %s orders even if imported beside sales", status => {
    const f = fixture(); f.sales.slice(0, 8).forEach(s => { s.status = status; });
    expect(run(f).productIds).not.toContain("popular");
  });
  it("subtracts approved returns and cancellations once, including non-restockable goods", () => {
    const f = fixture();
    for (let n = 0; n < 4; n++) f.counters.set(`line${n}`, { organizationId: org, saleId: `sale${n}`, saleItemId: `line${n}`, returnedQuantity: 10 });
    expect(run(f).productIds).not.toContain("popular");
    f.counters.get("line3")!.returnedQuantity = 5; // partial return leaves one genuine purchase
    expect(run(f).productIds).toContain("popular");
    f.items[3]!.cancelledQuantity = 5;
    expect(run(f).productIds).not.toContain("popular");
  });
  it("counts completed delayed-pickup sales, removing cancelled uncollected units", () => {
    const f = fixture(); f.items.slice(0, 4).forEach(i => { i.cancelledQuantity = i.quantity; });
    expect(run(f).productIds).not.toContain("popular");
  });
  it("requires repeat purchases spread across three Lagos days", () => {
    const f = fixture(); f.sales.forEach(s => { s.recordedAt = new Date(now - 1000).toISOString(); });
    expect(run(f)).toMatchObject({ status: "insufficient_history", productIds: [] });
    const short = fixture(); short.sales = short.sales.slice(0, 9); short.items = short.items.slice(0, 9);
    expect(run(short).status).toBe("insufficient_history");
  });
  it("uses Lagos calendar days when purchases straddle UTC midnight", () => {
    const f = fixture(); const dates = ["2026-10-18T22:30:00Z", "2026-10-18T23:30:00Z", "2026-10-19T23:30:00Z"];
    f.sales.forEach((sale, n) => { sale.recordedAt = dates[n % 3]!; });
    expect(run(f)).toMatchObject({ status: "ready", productIds: ["popular"] });
  });
  it("includes ties at the 20% cutoff without arbitrary ID winners", () => {
    const f = fixture(); f.items.forEach((l, n) => { l.productId = n < 10 ? "popular" : "tied"; }); f.products.push(product("tied"));
    expect(run(f).productIds).toEqual(["popular", "tied"]);
  });
  it("keeps branches and organizations isolated", () => {
    const f = fixture(); f.sales.slice(0, 8).forEach(s => { s.branchId = "foreign"; });
    expect(run(f).productIds).not.toContain("popular");
    const g = fixture(); g.items[0]!.organizationId = "foreign";
    expect(run(g).status).toBe("unavailable");
    const h = fixture(); h.counters.set("line0", { organizationId: "foreign", saleId: "sale0", saleItemId: "line0", returnedQuantity: 1 });
    expect(run(h).status).toBe("unavailable");
  });
  it("does not invent unit conversions or combine different SKUs/variants", () => {
    const f = fixture(); f.items[0]!.unitOfMeasure = "carton";
    expect(run(f).productIds).not.toContain("popular");
    const g = fixture(); g.items.slice(0, 8).forEach((l, n) => { l.productId = `variant${n}`; g.products.push(product(l.productId, "carton")); l.unitOfMeasure = "carton"; });
    expect(run(g).productIds).toEqual([]);
  });
  it("rejects missing lines, corrupt quantities and over-returned evidence", () => {
    const f = fixture(); f.items.pop(); expect(run(f).status).toBe("unavailable");
    const g = fixture(); g.items[0]!.quantity = NaN; expect(run(g).status).toBe("unavailable");
    const h = fixture(); h.counters.set("line0", { organizationId: org, saleId: "sale0", saleItemId: "line0", returnedQuantity: 11 }); expect(run(h).status).toBe("unavailable");
  });
  it("uses the rolling window and expires the cache after 15 minutes", () => {
    const f = fixture(); f.sales.slice(0, 8).forEach(s => { s.recordedAt = new Date(now - FAST_MOVING_WINDOW_MS - 1).toISOString(); });
    expect(run(f).productIds).not.toContain("popular");
    expect(Date.parse(run().expiresAt) - now).toBe(900_000);
  });
});

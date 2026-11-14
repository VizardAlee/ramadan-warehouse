import { describe, expect, it } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { readPosCatalogue } from "../functions/src/sales/pos-catalogue";
import { matchesProductName } from "../src/features/products/name-search";
function fixture(count: number, mismatch = false) {
  const products = Array.from({ length: count }, (_, n) => ({ id: `p${String(n).padStart(4, "0")}` }));
  const requests: string[] = [];
  const q = (after = "", size = 250): object => ({
    where: () => q(after, size), orderBy: () => q(after, size),
    startAfter: (cursor: { id: string }) => q(cursor.id, size), limit: (n: number) => q(after, n),
    get: async () => { const docs = products.filter(p => p.id > after).slice(0, size); return { docs, size: docs.length }; },
  });
  const db = {
    collection: () => q(), doc: (path: string) => path,
    getAll: async (...paths: string[]) => paths.map(path => {
      requests.push(path);
      const productId = path.match(/p\d{4}/i)?.[0]?.toLowerCase();
      return { id: path.split("/")[1], exists: true, get: (key: string) => ({
        organizationId: mismatch ? "foreign" : "org", productId, branchId: "branch", locationId: "stock",
      })[key as "organizationId"] };
    }),
  } as unknown as Firestore;
  return { db, requests };
}
describe("complete POS catalogue", () => {
  it("loads beyond200 and500 and joins every product's prices and exact branch stock", async () => {
    const { db, requests } = fixture(603);
    const result = await readPosCatalogue(db, "org", "branch", "stock");
    expect(result.products.docs).toHaveLength(603);
    expect(result.prices.docs).toHaveLength(603);
    expect(result.branchPrices.docs).toHaveLength(603);
    expect(result.balances.docs).toHaveLength(603);
    expect(requests).toHaveLength(1809);
    expect(requests).toContain("productSalesPrices/p0602");
    expect(requests).toContain("inventoryBalances/org__p0602__stock__base");
  });
  it("handles empty catalogues without empty getAll calls", async () => {
    const { db, requests } = fixture(0);
    expect((await readPosCatalogue(db, "org", "branch", "stock")).products.docs).toEqual([]);
    expect(requests).toEqual([]);
  });
  it("fails closed above bounded offline capacity rather than returning a partial list", async () => {
    const { db, requests } = fixture(5001);
    await expect(readPosCatalogue(db, "org", "branch", "stock")).rejects.toMatchObject({ code: "resource-exhausted" });
    expect(requests).toEqual([]);
  });
  it("rejects foreign organization records instead of exposing their price", async () => {
    await expect(readPosCatalogue(fixture(1, true).db, "org", "branch", "stock")).rejects.toMatchObject({ code: "failed-precondition" });
  });
  it("matches spacing/punctuation variants without matching hidden identifiers", () => {
    expect(matchesProductName("Lithium8kWhHaisicWallMount", "wall mount")).toBe(true);
    expect(matchesProductName("Haisic Wall-Mount", "wallmount")).toBe(true);
    expect(matchesProductName("Lithium 8kwh Haisic wall mount", "wall mount")).toBe(true);
    expect(matchesProductName("Haisic battery", "SKU-EDEF762")).toBe(false);
  });
});

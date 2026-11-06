import { db } from "../admin.js";
/** Enrich an already authorized, bounded page. Never changes stored movements. */
export async function inventoryProductLabels<T extends Record<string, unknown>>(organizationId: string, rows: T[]): Promise<Array<T & { productName: string }>> {
  const ids = [...new Set(rows.flatMap(row => typeof row.productId === "string" && row.productId && !row.productId.includes("/") ? [row.productId] : []))];
  const names = new Map<string, string>();
  for (let start = 0; start < ids.length; start += 100) {
    const products = await db.getAll(...ids.slice(start, start + 100).map(id => db.doc(`products/${id}`)));
    for (const product of products) if (product.get("organizationId") === organizationId && typeof product.get("name") === "string") names.set(product.id, product.get("name"));
  }
  return rows.map(row => ({ ...row, productName: typeof row.productName === "string" && row.productName.trim() ? row.productName : names.get(String(row.productId)) ?? "Product name unavailable" }));
}

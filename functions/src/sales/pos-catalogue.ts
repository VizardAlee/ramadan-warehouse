import { FieldPath, type Firestore, type DocumentSnapshot, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { balanceDocumentId, uniquenessDocumentId } from "../inventory/calculations.js";

/** Complete bounded catalogue, never silently a first-N subset. Related records are
 * read by the same product IDs so independent query limits cannot lose prices. */
export async function readPosCatalogue(db: Firestore, organizationId: string, branchId: string, locationId: string) {
  const products: QueryDocumentSnapshot[] = [];
  const query = db.collection("products").where("organizationId", "==", organizationId).orderBy(FieldPath.documentId());
  let cursor: QueryDocumentSnapshot | undefined;
  for (;;) {
    const page = await (cursor ? query.startAfter(cursor) : query).limit(250).get();
    products.push(...page.docs);
    if (products.length > 5000) throw new HttpsError("resource-exhausted", "The POS catalogue exceeds the supported offline workspace size. No partial catalogue was loaded. Contact an administrator.");
    if (page.size < 250) break;
    cursor = page.docs.at(-1);
  }
  const prices: DocumentSnapshot[] = [], branchPrices: DocumentSnapshot[] = [], balances: DocumentSnapshot[] = [];
  for (let offset = 0; offset < products.length; offset += 100) {
    const chunk = products.slice(offset, offset + 100);
    const refs = chunk.flatMap(product => [
      db.doc(`productSalesPrices/${product.id}`),
      db.doc(`branchSalesPrices/${uniquenessDocumentId(organizationId, "branchSalesPrice", branchId, product.id)}`),
      db.doc(`inventoryBalances/${balanceDocumentId(organizationId, product.id, locationId)}`),
    ]);
    const documents = await db.getAll(...refs);
    chunk.forEach((product, index) => {
      const central = documents[index * 3]!, local = documents[index * 3 + 1]!, balance = documents[index * 3 + 2]!;
      if ((central.exists && (central.get("organizationId") !== organizationId || central.get("productId") !== product.id)) ||
          (local.exists && (local.get("organizationId") !== organizationId || local.get("branchId") !== branchId || local.get("productId") !== product.id)) ||
          (balance.exists && (balance.get("organizationId") !== organizationId || balance.get("locationId") !== locationId || balance.get("productId") !== product.id)))
        throw new HttpsError("failed-precondition", "The POS catalogue contains a mismatched price or stock record. No partial catalogue was loaded.");
      if (central.exists) prices.push(central);
      if (local.exists) branchPrices.push(local);
      if (balance.exists) balances.push(balance);
    });
  }
  return { products: { docs: products }, prices: { docs: prices }, branchPrices: { docs: branchPrices }, balances: { docs: balances } };
}

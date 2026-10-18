import type { DocumentSnapshot, Transaction } from "firebase-admin/firestore";
import { db } from "../admin.js";
import { addLots, exactLots, type LotAllocation } from "./reservation-ownership.js";
import { executionIdentity, stockReview } from "./stock-execution.js";

export interface DispatchContents {
  itemId: string;
  productId: string;
  trackingType: string;
  quantity: number;
  serialItemIds: string[];
  lotAllocations: LotAllocation[];
}
type Reader = Pick<Transaction, "get" | "getAll">;
export async function readDispatchContents(reader: Reader, transfer: DocumentSnapshot, dispatch: DocumentSnapshot, confirming = false) {
  const packageIds = dispatch.get("packageIds") as string[];
  if (!Array.isArray(packageIds) || !packageIds.length || new Set(packageIds).size !== packageIds.length)
    stockReview("Dispatch packages must have distinct, explicit identities.");
  const packages = await reader.getAll(...packageIds.map(id => db.doc(`transferPackages/${id}`)));
  if (packages.some(pkg => !pkg.exists || pkg.get("organizationId") !== transfer.get("organizationId") || pkg.get("transferId") !== transfer.id || pkg.get("status") !== (confirming ? "sealed" : "dispatched")))
    stockReview("Dispatch package ownership or sealing evidence is inconsistent.");
  const rows: DocumentSnapshot[] = [];
  for (let offset = 0; offset < packageIds.length; offset += 30) {
    const page = await reader.get(db.collection("transferPackageItems").where("packageId", "in", packageIds.slice(offset, offset + 30)));
    rows.push(...page.docs);
  }
  const grouped = new Map<string, DispatchContents>();
  const packageTotals = new Map<string, number>();
  for (const row of rows) {
    if (row.get("organizationId") !== transfer.get("organizationId") || row.get("transferId") !== transfer.id || !Number.isSafeInteger(row.get("quantity")) || Number(row.get("quantity")) <= 0)
      stockReview("Dispatch package contents lack consistent transfer ownership or quantities.");
    const itemId = String(row.get("transferItemId"));
    const productId = String(row.get("productId"));
    const current = grouped.get(itemId) ?? { itemId, productId, trackingType: "", quantity: 0, serialItemIds: [], lotAllocations: [] };
    if (current.productId !== productId) stockReview("A dispatch item refers to more than one product.");
    current.quantity += Number(row.get("quantity"));
    current.serialItemIds.push(...((row.get("serialItemIds") ?? []) as string[]));
    current.lotAllocations = addLots(current.lotAllocations, exactLots((row.get("lotAllocations") ?? []) as LotAllocation[]));
    grouped.set(itemId, current);
    const packageId = String(row.get("packageId"));
    packageTotals.set(packageId, (packageTotals.get(packageId) ?? 0) + Number(row.get("quantity")));
  }
  if (!grouped.size || packages.some(pkg => packageTotals.get(pkg.id) !== Number(pkg.get("quantity"))) || [...grouped.values()].reduce((sum, line) => sum + line.quantity, 0) !== Number(dispatch.get("quantity")))
    stockReview("Dispatch quantity does not equal its complete package contents.");
  const items = await reader.getAll(...[...grouped.keys()].map(id => db.doc(`transferItems/${id}`)));
  const allSerials: string[] = [];
  for (const item of items) {
    const line = grouped.get(item.id)!;
    if (!item.exists || item.get("organizationId") !== transfer.get("organizationId") || item.get("transferId") !== transfer.id || item.get("productId") !== line.productId)
      stockReview("Dispatch item ownership is inconsistent.");
    line.trackingType = String(item.get("trackingType"));
    if ((line.trackingType === "serial" ? line.serialItemIds.length !== line.quantity : line.serialItemIds.length > 0)
      || (line.trackingType === "batch" ? line.lotAllocations.reduce((sum, lot) => sum + lot.quantity, 0) !== line.quantity : line.lotAllocations.length > 0))
      stockReview("Dispatch tracking identities do not match the package quantities.");
    allSerials.push(...line.serialItemIds);
  }
  if (new Set(allSerials).size !== allSerials.length) stockReview("The same serial appears more than once in this dispatch.");
  const contents = [...grouped.values()].sort((a, b) => a.itemId.localeCompare(b.itemId));
  for (const line of contents) {
    line.serialItemIds.sort();
    line.lotAllocations.sort((a, b) => a.lotId.localeCompare(b.lotId));
  }
  if (!confirming) {
    const frozen = await reader.get(db.collection("transferDispatchItems").where("dispatchId", "==", dispatch.id));
    if (frozen.size) {
      if (frozen.docs.some(doc => doc.get("allocationVersion") !== 2 || doc.get("organizationId") !== transfer.get("organizationId") || doc.get("transferId") !== transfer.id))
        stockReview("This dispatch has ambiguous frozen stock-content evidence.");
      const manifest = frozen.docs.map(doc => ({ itemId: String(doc.get("transferItemId")), productId: String(doc.get("productId")), trackingType: String(doc.get("trackingType")), quantity: Number(doc.get("quantity")), serialItemIds: doc.get("serialItemIds"), lotAllocations: doc.get("lotAllocations") })).sort((a, b) => a.itemId.localeCompare(b.itemId));
      if (executionIdentity(contents) !== executionIdentity(manifest)) stockReview("Dispatch packages no longer match their immutable stock manifest.");
    }
  }
  return contents;
}

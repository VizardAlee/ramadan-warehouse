import { HttpsError } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import { visitQueryPages } from "../utils/query-pages.js";
import { requireProcurementScope, type ProcurementAccess } from "./authorize.js";

/** Load the selected store before limits, so a newly added branch is never
 * omitted by a company-wide metadata cap. This is not an inventory read grant. */
export async function selectedPurchasingLocationOptions(actor: ProcurementAccess, scope: { branchId?: string; warehouseId?: string }) {
  requireProcurementScope(actor, scope, "procurement.read");
  const field = scope.branchId ? "branchId" : "warehouseId";
  const collection = scope.branchId ? "branches" : "warehouses";
  const ownerId = scope.branchId ?? scope.warehouseId;
  if (!ownerId || ownerId.includes("/")) throw new HttpsError("invalid-argument", "Choose a valid purchasing location.");
  const owner = await db.doc(`${collection}/${ownerId}`).get();
  if (!owner.exists || owner.get("organizationId") !== actor.organizationId || owner.get("status") !== "active")
    throw new HttpsError("not-found", "The selected purchasing location is unavailable.");
  const locations: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  let scanned = 0;
  await visitQueryPages(db.collection("inventoryLocations").where("organizationId", "==", actor.organizationId).where(field, "==", owner.id), documents => {
    scanned += documents.length;
    if (scanned > 10000) throw new HttpsError("resource-exhausted", "The selected branch's receiving locations require review; no partial list was returned.");
    locations.push(...documents.filter(document => document.get("status") === "active"));
  });
  return { branches: scope.branchId ? [owner] : [], warehouses: scope.warehouseId ? [owner] : [], locations };
}

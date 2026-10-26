import { Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { db } from "../admin.js";
import { hasServerPermission, requireBranchScope, type AccessProfile } from "../auth/authorize.js";
import { parseInput } from "../utils/callable.js";

const id = z.string().min(1).max(200).refine(value => !value.includes("/") && value !== "." && value !== "..");
export const waybillRegisterInput = z.object({
  action: z.literal("list_waybills"), branchId: id,
  invoiceNumber: z.string().trim().max(100).optional(),
  cursor: id.optional(), limit: z.number().int().min(1).max(100).default(25),
});

/** Read-only projection of recorded physical handovers, using existing document authority. */
export async function readWaybillRegister(actor: AccessProfile, data: unknown) {
  if (!["reports.sales.read", "sales.read.own_branch", "sales.read.all"].some(permission => hasServerPermission(actor, permission as "reports.sales.read" | "sales.read.own_branch" | "sales.read.all")))
    throw new HttpsError("permission-denied", "You do not have permission to view sale documents.");
  const input = parseInput(waybillRegisterInput, data);
  requireBranchScope(actor, input.branchId);
  const branch = await db.doc(`branches/${input.branchId}`).get();
  if (!branch.exists || branch.get("organizationId") !== actor.organizationId)
    throw new HttpsError("not-found", "Store unavailable.");
  let query = db.collection("saleCollections").where("organizationId", "==", actor.organizationId).where("branchId", "==", input.branchId);
  if (input.invoiceNumber) query = query.where("referenceNumber", "==", input.invoiceNumber);
  // Equality queries use Firestore's stable implicit document-name ordering.
  // This preserves existing index merging and includes undated historical handovers.
  if (input.cursor) {
    const cursor = await db.doc(`saleCollections/${input.cursor}`).get();
    if (!cursor.exists || cursor.get("organizationId") !== actor.organizationId || cursor.get("branchId") !== input.branchId || (input.invoiceNumber && cursor.get("referenceNumber") !== input.invoiceNumber))
      throw new HttpsError("invalid-argument", "This waybill page is unavailable for the selected filters.");
    query = query.startAfter(cursor);
  }
  const result = await query.limit(input.limit + 1).get();
  const records = result.docs.slice(0, input.limit);
  const saleIds = [...new Set(records.map(record => String(record.get("saleId"))))];
  if (saleIds.some(value => !id.safeParse(value).success)) throw new HttpsError("data-loss", "Handover evidence is inconsistent.");
  const sales = saleIds.length ? await db.getAll(...saleIds.map(value => db.doc(`sales/${value}`))) : [];
  const saleById = new Map(sales.map(sale => [sale.id, sale]));
  const movementIds = [...new Set(records.map(record => record.get("inventoryTransactionId")).filter((value): value is string => typeof value === "string" && id.safeParse(value).success))];
  const movements = movementIds.length ? await db.getAll(...movementIds.map(value => db.doc(`inventoryTransactions/${value}`))) : [];
  const movementById = new Map(movements.filter(movement => movement.exists && movement.get("organizationId") === actor.organizationId && records.some(record => record.get("inventoryTransactionId") === movement.id && ((movement.get("referenceType") === "saleCollection" && movement.get("referenceId") === record.id) || (movement.get("referenceType") === "sale" && movement.get("referenceId") === record.get("saleId") && movement.get("transactionType") === "branch_sale")))).map(movement => [movement.id, String(movement.get("transactionNumber"))]));
  const rows = records.map(record => {
    const sale = saleById.get(String(record.get("saleId")));
    if (!sale?.exists || sale.get("organizationId") !== actor.organizationId || sale.get("branchId") !== input.branchId || sale.get("status") !== "completed" || !(Number(record.get("totalQuantity")) > 0))
      throw new HttpsError("data-loss", "Handover evidence is inconsistent.");
    return { id: record.id, waybillNumber: `WB-${movementById.get(String(record.get("inventoryTransactionId"))) ?? record.id}`, saleId: sale.id, branchId: input.branchId, invoiceNumber: String(sale.get("saleNumber")), collectedAt: record.get("collectedAt") instanceof Timestamp ? (record.get("collectedAt") as Timestamp).toDate().toISOString() : null,
      totalQuantity: Number(record.get("totalQuantity")), dispatcherPhone: record.get("dispatcherPhone") ?? null, vehiclePlate: record.get("vehiclePlate") ?? null, deliveryRecipientName: record.get("deliveryRecipientName") ?? null };
  });
  return { rows, nextCursor: result.size > input.limit ? records.at(-1)!.id : null };
}

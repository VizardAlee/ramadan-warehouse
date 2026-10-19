import { safeActorName } from "./authority.js";

export const referenceKeys = ["saleNumber", "receiptNumber", "transferNumber", "requestNumber", "purchaseOrderNumber", "invoiceNumber", "returnNumber", "expenseNumber", "supplierNumber", "customerNumber", "sku", "staffId", "code"] as const;
const text = (value: unknown, max = 240) => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "";
export function auditReference(record: Record<string, unknown>): string | null {
  const after = record.after && typeof record.after === "object" ? record.after as Record<string, unknown> : {};
  for (const key of referenceKeys) { const value = text(after[key]); if (value) return value; }
  return null;
}
export function auditModule(action: unknown) { return text(action, 120).split(".")[0] || "unknown"; }
export function auditLocation(after: unknown): Record<string, string> | null {
  if (!after || typeof after !== "object") return null;
  const output: Record<string, string> = {};
  for (const key of ["branchId", "warehouseId", "locationId", "sourceBranchId", "destinationBranchId", "sourceWarehouseId", "destinationWarehouseId"]) {
    const value = (after as Record<string, unknown>)[key];
    if (typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value)) output[key] = value;
  }
  return Object.keys(output).length ? output : null;
}
/** Never return raw before/after or arbitrary event fields from the activity reader. */
export function projectActivity(id: string, record: Record<string, unknown>, currentName?: string) {
  const timestamp = record.createdAt as { toDate?: () => Date } | undefined;
  const snapshot = safeActorName(record.actorDisplayName);
  return {
    id, action: text(record.action, 160), module: auditModule(record.action), entityType: text(record.entityType, 120),
    entityId: text(record.entityId, 128), actorUserId: text(record.actorUserId, 128), actorRoleId: text(record.actorRoleId, 80),
    actorName: snapshot ?? safeActorName(currentName) ?? null,
    actorNameEvidence: snapshot ? "recorded_snapshot" : safeActorName(currentName) ? "current_name" : "uid_only",
    reference: auditReference(record), reason: text(record.reason, 1000) || null,
    correlationId: text(record.correlationId, 128), sourceFunction: text(record.sourceFunction, 160),
    location: auditLocation(record.locationEvidence),
    createdAt: timestamp?.toDate?.().toISOString() ?? null,
  };
}

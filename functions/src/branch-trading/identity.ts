import { uniquenessDocumentId } from "../inventory/calculations.js";
export function internalTradeBalanceId(organizationId:string, headOfficeBranchId:string, branchId:string) {
  return uniquenessDocumentId(organizationId,headOfficeBranchId,branchId);
}

/** Supplier identity for new transfers only; existing agreements are immutable.
 * Unassigned warehouses remain nonfinancial rather than inventing an owner. */
export function internalTradeSupplier(config: Record<string, unknown>, source: Record<string, unknown>, destination: Record<string, unknown>): string | null {
  if (destination.type !== "branch" || typeof destination.branchId !== "string" || !destination.branchId) return null;
  const supplier = source.type === "branch" ? source.branchId
    : source.type === "warehouse" && config.headOfficeSupplyWarehouseId && source.warehouseId === config.headOfficeSupplyWarehouseId ? config.headOfficeBranchId : null;
  return typeof supplier === "string" && supplier && supplier !== destination.branchId ? supplier : null;
}

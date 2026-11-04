import { uniquenessDocumentId } from "../inventory/calculations.js";
export function internalTradeBalanceId(organizationId:string, headOfficeBranchId:string, branchId:string) {
  return uniquenessDocumentId(organizationId,headOfficeBranchId,branchId);
}

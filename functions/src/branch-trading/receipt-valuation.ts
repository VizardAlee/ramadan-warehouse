import { allocateTransport, receiptTransportShare } from "./landed-cost.js";
import { issueManagementCost } from "../inventory/management-cost.js";

export interface ReceiptValuationInput {
  sourceQuantity: number;
  sourceCompanyMinor: number;
  sourceManagementMinor?: number;
  received: number;
  damaged: number;
  /** Present only for new, explicitly priced management-cost transfers. */
  agreedUnitPriceMinor?: number;
  transport?: { allocatedMinor: number; approvedQuantity: number; previouslyReceivedOrDamaged: number };
  serials?: readonly { id: string; companyMinor: number; managementMinor?: number; damaged: boolean }[];
}
function natural(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${name}.`);
  return value;
}
function sum(values: readonly number[]): number {
  return natural(values.reduce((a,b)=>a+b,0), "valuation total");
}
/** Read-only receipt plan. No mutation, journals or payments. Its totals must be
 * applied together by the transaction integration; never use a displayed rounded
 * unit cost to recreate these exact line values.
 */
export function planReceiptValuation(input: ReceiptValuationInput) {
  const quantity = sum([natural(input.received,"received quantity"),natural(input.damaged,"damaged quantity")]);
  natural(input.sourceQuantity,"source quantity");
  natural(input.sourceCompanyMinor,"company stock value");
  const management = natural(input.sourceManagementMinor ?? input.sourceCompanyMinor,"management stock value");
  if (!quantity || quantity > input.sourceQuantity) throw new Error("Receipt exceeds source stock.");
  if (input.agreedUnitPriceMinor !== undefined) natural(input.agreedUnitPriceMinor,"agreed transfer price");
  if (input.transport && input.agreedUnitPriceMinor === undefined) throw new Error("Transport requires an explicit new management-cost agreement.");
  const serials = input.serials;
  if (serials && (serials.length !== quantity || new Set(serials.map(s=>s.id)).size !== quantity || serials.some(s=>!s.id) || serials.filter(s=>s.damaged).length !== input.damaged)) throw new Error("Serial receipt evidence does not match quantities.");
  if (serials) for (const serial of serials) { natural(serial.companyMinor,"serial company cost"); natural(serial.managementMinor ?? serial.companyMinor,"serial management cost"); }
  const outgoingCompany = issueManagementCost({quantity:input.sourceQuantity,totalValueMinor:input.sourceCompanyMinor},quantity,serials ? sum(serials.map(s=>s.companyMinor)) : undefined);
  const outgoingManagement = issueManagementCost({quantity:input.sourceQuantity,totalValueMinor:input.sourceCompanyMinor,managementTotalValueMinor:management},quantity,serials ? sum(serials.map(s=>s.managementMinor ?? s.companyMinor)) : undefined);
  const transportMinor = input.transport ? receiptTransportShare(input.transport.allocatedMinor,input.transport.approvedQuantity,input.transport.previouslyReceivedOrDamaged,quantity) : 0;
  const weights = serials ? serials.map(s=>({id:s.id,weight:1})) : [{id:"good",weight:input.received},{id:"damaged",weight:input.damaged}];
  const freight = allocateTransport(transportMinor, weights);
  const companyBase = serials ? Object.fromEntries(serials.map(s=>[s.id,s.companyMinor])) : allocateTransport(outgoingCompany.movementValueMinor,weights);
  const managementBase = input.agreedUnitPriceMinor !== undefined
    ? Object.fromEntries(weights.map(w=>[w.id,natural(input.agreedUnitPriceMinor!*w.weight,"agreed line value")]))
    : serials ? Object.fromEntries(serials.map(s=>[s.id,s.managementMinor ?? s.companyMinor])) : allocateTransport(outgoingManagement.movementValueMinor,weights);
  const rows = weights.map(row=>({id:row.id,damaged:serials ? serials.find(s=>s.id===row.id)!.damaged : row.id === "damaged",companyMinor:sum([companyBase[row.id]!,freight[row.id]!]),managementMinor:sum([managementBase[row.id]!,freight[row.id]!]),transportMinor:freight[row.id]!}));
  const total=(damaged:boolean,field:"companyMinor"|"managementMinor"|"transportMinor")=>sum(rows.filter(r=>r.damaged===damaged).map(r=>r[field]));
  return {outgoingCompanyMinor:outgoingCompany.movementValueMinor,outgoingManagementMinor:outgoingManagement.movementValueMinor,remainingCompanyMinor:outgoingCompany.remainingValueMinor,remainingManagementMinor:outgoingManagement.remainingValueMinor,companyReceivedMinor:total(false,"companyMinor"),companyDamagedMinor:total(true,"companyMinor"),managementReceivedMinor:total(false,"managementMinor"),managementDamagedMinor:total(true,"managementMinor"),transportMinor,serials:serials?rows:[]};
}

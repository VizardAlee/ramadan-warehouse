import { issueCost } from "../inventory/calculations.js";
/** Parallel managerial issue; never changes company valuation. */
export function issueManagementCost(quantity: number, totalValueMinor: number, issuedQuantity: number, serialCosts?: number[]) {
  if (![quantity,totalValueMinor,issuedQuantity].every(Number.isSafeInteger) || quantity<=0 || issuedQuantity<=0 || issuedQuantity>quantity || totalValueMinor<0) throw new Error("Invalid branch management valuation.");
  if (serialCosts && (serialCosts.length!==issuedQuantity || serialCosts.some(cost=>!Number.isSafeInteger(cost)||cost<0))) throw new Error("Invalid serial management cost.");
  const value=serialCosts ? serialCosts.reduce((a,b)=>a+b,0) : Number((BigInt(totalValueMinor)*BigInt(issuedQuantity)*2n+BigInt(quantity))/(BigInt(quantity)*2n));
  if (!Number.isSafeInteger(value)||value>totalValueMinor || (issuedQuantity===quantity && value!==totalValueMinor)) throw new Error("Management stock valuation requires reconciliation.");
  return issueCost({quantity,totalValueMinor,averageUnitCostMinor:Math.round(totalValueMinor/quantity)},issuedQuantity,value);
}

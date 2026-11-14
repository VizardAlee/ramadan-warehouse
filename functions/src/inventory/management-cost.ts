/** Parallel managerial costing. Company totals remain the fallback for legacy stock. */
export function issueManagementCost(balance: {quantity:number;totalValueMinor:number;managementTotalValueMinor?:number}, quantity:number, explicitValueMinor?:number) {
  const total=balance.managementTotalValueMinor ?? balance.totalValueMinor;
  if (![balance.quantity,quantity,total].every(Number.isSafeInteger) || total<0 || quantity<=0 || quantity>balance.quantity) throw new Error("Invalid managerial stock valuation.");
  const value=explicitValueMinor ?? Number((BigInt(total)*BigInt(quantity)*2n+BigInt(balance.quantity))/(BigInt(balance.quantity)*2n));
  if (!Number.isSafeInteger(value) || value<0 || value>total || (quantity===balance.quantity && value!==total)) throw new Error("Managerial issue does not reconcile.");
  return {movementValueMinor:value,remainingValueMinor:total-value};
}

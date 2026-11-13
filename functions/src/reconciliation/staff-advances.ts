export interface AdvanceBalance { issuedMinor: number; retiredMinor: number; returnedMinor: number; }
export function outstandingAdvance(balance: AdvanceBalance): number {
  if (!Number.isSafeInteger(balance.issuedMinor) || balance.issuedMinor <= 0 ||
      !Number.isSafeInteger(balance.retiredMinor) || balance.retiredMinor < 0 ||
      !Number.isSafeInteger(balance.returnedMinor) || balance.returnedMinor < 0 ||
      balance.retiredMinor > balance.issuedMinor || balance.returnedMinor > balance.issuedMinor - balance.retiredMinor)
    throw new Error("Advance balance needs reconciliation.");
  return balance.issuedMinor - balance.retiredMinor - balance.returnedMinor;
}
export function applyAdvanceSettlement(balance: AdvanceBalance, kind: "retire" | "return", amountMinor: number): AdvanceBalance & { outstandingMinor: number; status: "open" | "closed" } {
  const outstanding = outstandingAdvance(balance);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || amountMinor > outstanding)
    throw new Error("Amount must be positive and cannot exceed this advance's outstanding balance.");
  const next = { ...balance, retiredMinor: balance.retiredMinor + (kind === "retire" ? amountMinor : 0), returnedMinor: balance.returnedMinor + (kind === "return" ? amountMinor : 0) };
  const outstandingMinor = outstandingAdvance(next);
  return { ...next, outstandingMinor, status: outstandingMinor === 0 ? "closed" : "open" };
}
export const advanceAsset = { accountCode: "1260", accountName: "Staff and driver advances" } as const;
export function advanceJournalLines(kind: "issue" | "return" | "retire", amountMinor: number, settlement?: { accountCode: string; accountName: string; bankAccountId?: string }) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new Error("Invalid advance amount.");
  if (kind !== "retire" && !settlement) throw new Error("Select the actual settlement account.");
  return kind === "issue" ? [
    { ...advanceAsset, debitMinor: amountMinor, creditMinor: 0 },
    { ...settlement!, debitMinor: 0, creditMinor: amountMinor },
  ] : [
    { ...(kind === "retire" ? { accountCode: "6000", accountName: "Operating expenses" } : settlement!), debitMinor: amountMinor, creditMinor: 0 },
    { ...advanceAsset, debitMinor: 0, creditMinor: amountMinor },
  ];
}

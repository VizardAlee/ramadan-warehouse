export interface MoneyTender {
  method: "cash" | "card" | "bank_transfer";
  amountMinor: number;
  bankAccountId?: string;
  reference?: string;
}

/** Monetary settlement only. Applying an existing advance is a separate noncash operation. */
export function tenderTotalError(tenders: readonly MoneyTender[], total: number): string | null {
  if (!Number.isSafeInteger(total) || total <= 0 || tenders.length < 1 || tenders.length > 20)
    return "Use one to twenty payment parts for a positive, exact amount.";
  let sum = 0;
  const seen = new Set<string>();
  for (const part of tenders) {
    if (!Number.isSafeInteger(part.amountMinor) || part.amountMinor <= 0)
      return "Every payment part needs a positive amount in whole kobo.";
    if (part.method === "cash" ? Boolean(part.bankAccountId) : !part.bankAccountId || (part.reference?.trim().length ?? 0) < 3)
      return "Cash has no bank account; each card or bank part needs the actual company account and reference.";
    const key = JSON.stringify([part.method, part.bankAccountId ?? "", part.reference?.trim() ?? ""]);
    if (seen.has(key)) return "Combine parts using the same method, account and reference; do not repeat a payment.";
    seen.add(key);
    sum += part.amountMinor;
    if (!Number.isSafeInteger(sum)) return "Payment parts exceed safe whole-kobo arithmetic.";
  }
  return sum === total ? null : "Payment parts must add up exactly to the amount being recorded.";
}

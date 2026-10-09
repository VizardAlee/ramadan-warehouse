/** Service receipts retain cash-basis recognition, allocating VAT exactly over part payments. */
export function serviceChargeVat(grossMinor: number, rateBasisPoints: number): number {
  if (!Number.isSafeInteger(grossMinor) || grossMinor < 0 || !Number.isSafeInteger(rateBasisPoints) || rateBasisPoints < 0 || rateBasisPoints > 10_000)
    throw new Error("Invalid service charge or configured VAT rate.");
  const denominator = BigInt(10_000 + rateBasisPoints);
  return Number((BigInt(grossMinor) * BigInt(rateBasisPoints) + denominator / 2n) / denominator);
}

export function serviceReceiptVat(paidBeforeMinor: number, paymentMinor: number, grossMinor: number, vatMinor: number): number {
  if (![paidBeforeMinor, paymentMinor, grossMinor, vatMinor].every(value => Number.isSafeInteger(value) && value >= 0) ||
    !Number.isSafeInteger(paidBeforeMinor + paymentMinor) || grossMinor <= 0 || vatMinor > grossMinor || paidBeforeMinor + paymentMinor > grossMinor)
    throw new Error("Invalid service receipt allocation.");
  const allocated = (paid: number) => Number((BigInt(paid) * BigInt(vatMinor) + BigInt(grossMinor) / 2n) / BigInt(grossMinor));
  return allocated(paidBeforeMinor + paymentMinor) - allocated(paidBeforeMinor);
}

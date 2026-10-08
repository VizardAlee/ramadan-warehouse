/** Original invoice snapshots, never current catalogue prices/tax rates. */
export function supplierReturnAmounts(values: {
  quantity: number; netMinor: number; vatMinor: number;
  returnedQuantity: number; returnedNetMinor: number; returnedVatMinor: number;
  returnQuantity: number; outstandingMinor: number; movementValueMinor: number;
}) {
  if (Object.values(values).some((value) => !Number.isSafeInteger(value) || value < 0) ||
    values.quantity <= 0 || values.returnQuantity <= 0 || values.returnedQuantity + values.returnQuantity > values.quantity)
    throw new Error("Return quantities or invoice amounts require reconciliation.");
  const portion = (amount: number, quantity: number) => Number((BigInt(amount) * BigInt(quantity) + BigInt(Math.floor(values.quantity / 2))) / BigInt(values.quantity));
  if (values.returnedNetMinor !== portion(values.netMinor, values.returnedQuantity) || values.returnedVatMinor !== portion(values.vatMinor, values.returnedQuantity))
    throw new Error("Earlier return amounts require reconciliation.");
  const returnedQuantity = values.returnedQuantity + values.returnQuantity;
  const returnedNetMinor = portion(values.netMinor, returnedQuantity);
  const returnedVatMinor = portion(values.vatMinor, returnedQuantity);
  const netMinor = returnedNetMinor - values.returnedNetMinor;
  const vatMinor = returnedVatMinor - values.returnedVatMinor;
  const grossMinor = netMinor + vatMinor;
  if (!Number.isSafeInteger(grossMinor) || grossMinor <= 0) throw new Error("Return credit must be a positive safe amount.");
  const payableReductionMinor = Math.min(grossMinor, values.outstandingMinor);
  return { returnedQuantity, returnedNetMinor, returnedVatMinor, netMinor, vatMinor, grossMinor,
    payableReductionMinor, supplierCreditMinor: grossMinor - payableReductionMinor,
    valuationVarianceMinor: netMinor - values.movementValueMinor };
}

export interface SaleCalculationLine {
  readonly quantity: number;
  readonly unitPriceMinor: number;
  readonly vatRateBasisPoints: number;
  readonly unitCostMinor: number;
}

export interface CalculatedSaleLine extends SaleCalculationLine {
  readonly netAmountMinor: number;
  readonly vatAmountMinor: number;
  readonly grossAmountMinor: number;
  readonly costAmountMinor: number;
}

export interface CalculatedSale {
  readonly lines: readonly CalculatedSaleLine[];
  readonly netAmountMinor: number;
  readonly vatAmountMinor: number;
  readonly grossAmountMinor: number;
  readonly costAmountMinor: number;
}

function safeNonNegativeInteger(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${name} must be a non-negative safe integer.`);
}

export function calculateSaleLine(
  line: SaleCalculationLine,
): CalculatedSaleLine {
  if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0)
    throw new Error("Quantity must be a positive safe integer.");
  safeNonNegativeInteger(line.unitPriceMinor, "Unit price");
  safeNonNegativeInteger(line.vatRateBasisPoints, "VAT rate");
  safeNonNegativeInteger(line.unitCostMinor, "Unit cost");
  if (line.vatRateBasisPoints > 10_000)
    throw new Error("VAT rate cannot exceed 100 percent.");
  const netAmountMinor = line.quantity * line.unitPriceMinor;
  const vatAmountMinor = Math.round(
    (netAmountMinor * line.vatRateBasisPoints) / 10_000,
  );
  const grossAmountMinor = netAmountMinor + vatAmountMinor;
  const costAmountMinor = line.quantity * line.unitCostMinor;
  for (const [name, value] of [
    ["Net amount", netAmountMinor],
    ["VAT amount", vatAmountMinor],
    ["Gross amount", grossAmountMinor],
    ["Cost amount", costAmountMinor],
  ] as const)
    safeNonNegativeInteger(value, name);
  return {
    ...line,
    netAmountMinor,
    vatAmountMinor,
    grossAmountMinor,
    costAmountMinor,
  };
}

export function calculateSale(
  input: readonly SaleCalculationLine[],
): CalculatedSale {
  if (input.length === 0) throw new Error("A sale requires at least one item.");
  const lines = input.map(calculateSaleLine);
  const total = (field: keyof CalculatedSaleLine) =>
    lines.reduce((sum, line) => sum + Number(line[field]), 0);
  const result = {
    lines,
    netAmountMinor: total("netAmountMinor"),
    vatAmountMinor: total("vatAmountMinor"),
    grossAmountMinor: total("grossAmountMinor"),
    costAmountMinor: total("costAmountMinor"),
  };
  for (const [name, value] of Object.entries(result).filter(
    ([key]) => key !== "lines",
  ))
    safeNonNegativeInteger(value as number, name);
  return result;
}

export function assertPaymentsEqualTotal(
  amountsMinor: readonly number[],
  grossAmountMinor: number,
) {
  if (amountsMinor.length === 0)
    throw new Error("A paid sale requires at least one payment.");
  amountsMinor.forEach((amount) =>
    safeNonNegativeInteger(amount, "Payment amount"),
  );
  if (amountsMinor.some((amount) => amount === 0))
    throw new Error("Payment amounts must be greater than zero.");
  if (amountsMinor.reduce((sum, amount) => sum + amount, 0) !== grossAmountMinor)
    throw new Error("Payment total must equal the sale total.");
}

export function assertBalancedJournal(
  lines: readonly { debitMinor: number; creditMinor: number }[],
) {
  if (lines.length === 0) throw new Error("A journal requires lines.");
  for (const line of lines) {
    safeNonNegativeInteger(line.debitMinor, "Journal debit");
    safeNonNegativeInteger(line.creditMinor, "Journal credit");
    if ((line.debitMinor === 0) === (line.creditMinor === 0))
      throw new Error("A journal line must contain exactly one non-zero side.");
  }
  const debits = lines.reduce((sum, line) => sum + line.debitMinor, 0);
  const credits = lines.reduce((sum, line) => sum + line.creditMinor, 0);
  if (debits !== credits) throw new Error("Journal debits and credits must balance.");
}

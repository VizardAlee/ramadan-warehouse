export interface ProformaDraftLine {
  productId: string;
  quantity: number;
  priceTier: "retail" | "wholesale";
  customUnitPrice: string;
}

export function proformaSaveIssue(validUntil: string, lines: ProformaDraftLine[]) {
  if (!validUntil) return "Choose Valid through (Lagos date) above before saving the quotation.";
  if (!lines.length) return "Add at least one quoted product before saving.";
  for (const [index, line] of lines.entries()) {
    if (!line.productId) return `Choose a product for quoted product ${index + 1}.`;
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 100000)
      return `Enter a whole quantity from 1 to 100000 for quoted product ${index + 1}.`;
    try { quotedLineInput(line); }
    catch (cause) { return `Quoted product ${index + 1}: ${cause instanceof Error ? cause.message : "Review the custom unit price."}`; }
  }
  return undefined;
}

export function quotedLineInput(line: ProformaDraftLine) {
  const amount = line.customUnitPrice.trim();
  if (amount && !/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(amount))
    throw new Error("Enter a non-negative quoted unit price with no more than two decimal places.");
  let unitPriceMinor: number | undefined;
  if (amount) {
    const [whole, fraction = ""] = amount.split(".");
    const kobo = BigInt(whole || "0") * 100n + BigInt(fraction.padEnd(2, "0"));
    if (kobo > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("The quoted unit price is too large.");
    unitPriceMinor = Number(kobo);
  }
  return {
    productId: line.productId,
    quantity: line.quantity,
    priceTier: line.priceTier,
    ...(unitPriceMinor !== undefined ? { unitPriceMinor } : {}),
  };
}

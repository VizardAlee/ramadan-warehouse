export function customerHistoryLabel(kind: string, detail: string) {
  if (kind === "sale") return `Sale · ${detail}`;
  if (kind === "return") return `Return · ${detail}`;
  const labels: Record<string, string> = {
    payment: "Payment received",
    credit_sale: "Added to amount owed",
    sale_return_credit: "Return credited to account",
    advance: "Advance received",
    refund: "Refund",
  };
  return labels[detail] ?? detail.replaceAll("_", " ");
}

export function customerHistoryTone(kind: string, detail: string) {
  if (detail === "credit_sale") return "attention" as const;
  if (kind === "sale") return "balance" as const;
  if (kind === "return" || detail.includes("refund")) return "outflow" as const;
  return "income" as const;
}

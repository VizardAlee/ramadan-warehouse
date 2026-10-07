export interface CustomerHistoryCursor {
  sale?: string;
  return?: string;
  account?: string;
}

export interface CustomerHistory {
  bankAccounts?: Array<{ id: string; bankName: string; accountName: string; accountNumberLast4: string }>;
  customer: { id: string; name: string; customerNumber: string; creditStatus: string; creditLimitMinor: number; outstandingBalanceMinor: number; availableCreditMinor: number; arrangements?: import("@/types/domain").CustomerArrangement[] };
  rows: Array<{ id: string; kind: string; reference: string; branchId: string; amountMinor: number; detail: string; at: string | null; accountName?: string; allocations?: Array<{ accountId: string; accountName: string; amountMinor: number }> }>;
  moreAvailable: boolean;
  nextCursor: CustomerHistoryCursor | null;
}

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
  return labels[detail.replaceAll(" ", "_")] ?? detail.replaceAll("_", " ");
}

export function customerHistoryTone(kind: string, detail: string) {
  if (detail.replaceAll(" ", "_") === "credit_sale") return "attention" as const;
  if (kind === "sale") return "balance" as const;
  if (kind === "return" || detail.includes("refund")) return "outflow" as const;
  if (["payment", "sale_return_credit", "advance"].includes(detail.replaceAll(" ", "_"))) return "income" as const;
  return "balance" as const;
}

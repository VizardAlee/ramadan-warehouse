export interface StatementEntry {
  entryType?: string;
  amountMinor: number;
  customerAccountId?: string;
  customerAccountName?: string;
  debtAmountMinor?: number;
  advanceAmountMinor?: number;
  allocations?: Array<{ accountId: string; accountName: string; amountMinor: number }>;
  invoiceAllocations?: Array<{ accountId?: string; saleId: string; saleNumber: string; amountMinor: number }>;
}

// A statement uses account entries only, not both a sale and its account entry.
// Historical entries without an explicit arrangement remain in General.
export function statementEntry(entry: StatementEntry, accountId?: string) {
  const allocations = entry.allocations ?? [];
  const selected = accountId ? allocations.filter(item => item.accountId === accountId) : allocations;
  if (accountId && (allocations.length ? !selected.length : (entry.customerAccountId ?? "general") !== accountId)) return null;
  const amountMinor = accountId && allocations.length
    ? Math.sign(entry.amountMinor) * selected.reduce((sum, item) => sum + item.amountMinor, 0) : entry.amountMinor;
  const debtKinds = ["credit_sale", "payment", "sale_return_credit", "advance_applied"];
  const advanceKinds = ["advance", "advance_applied", "advance_sale", "advance_refund"];
  const known = [...debtKinds, ...advanceKinds].includes(entry.entryType ?? "");
  const debt = entry.debtAmountMinor ?? (debtKinds.includes(entry.entryType ?? "") ? entry.amountMinor : known ? 0 : null);
  const advance = entry.advanceAmountMinor ?? (advanceKinds.includes(entry.entryType ?? "") ? entry.amountMinor : known ? 0 : null);
  const project = (value: number | null) => value === null ? null : !accountId || !allocations.length || value === 0 ? value
    : Math.abs(value) === Math.abs(entry.amountMinor) ? Math.sign(value) * Math.abs(amountMinor) : null;
  return {
    amountMinor,
    accountName: accountId && selected.length === 1 ? selected[0]!.accountName : entry.customerAccountName ?? "General account",
    allocations: selected,
    invoiceAllocations: (entry.invoiceAllocations ?? []).filter(item => !accountId || (item.accountId ?? "general") === accountId),
    debtChangeMinor: project(debt), advanceChangeMinor: project(advance),
    needsReview: project(debt) === null || project(advance) === null,
  };
}

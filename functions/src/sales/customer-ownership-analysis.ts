export type OwnershipRecord = { id: string; collection: string; data: Record<string, unknown> };
export type OwnershipBranch = { id: string; name: string; status: string };
export const ownershipCollections = ["sales", "salesOrders", "customerPayments", "customerAccountEntries", "saleReturns", "salesCredits", "aftersalesCases", "proformaQuotes"] as const;
const money = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Evidence only: never infer, select or write an owning branch. */
export function analyzeCustomerOwnership(customer: Record<string, unknown>, branches: OwnershipBranch[], records: OwnershipRecord[], complete = true) {
  const currentBranchId = typeof customer.branchId === "string" && customer.branchId ? customer.branchId : null;
  const branchMap = new Map(branches.map(branch => [branch.id, branch]));
  const issues: string[] = [];
  if (!currentBranchId) issues.push("missing_owner");
  else if (!branchMap.has(currentBranchId)) issues.push("invalid_owner");
  else if (branchMap.get(currentBranchId)!.status !== "active") issues.push("inactive_owner");
  const activity = new Map<string, { branchId: string; branchName: string; recordCount: number; unpaidMinor: number; exchangeCreditMinor: number }>();
  let unattributedRecords = 0, invalidAmounts = false;
  const openInvoices: Array<{ id: string; number: string; branchId: string | null; outstandingMinor: number | null; tracked: boolean }> = [];
  for (const record of records) {
    const branchId = typeof record.data.branchId === "string" && branchMap.has(record.data.branchId) ? record.data.branchId : null;
    if (!branchId) unattributedRecords++;
    const entry = branchId ? activity.get(branchId) ?? { branchId, branchName: branchMap.get(branchId)!.name, recordCount: 0, unpaidMinor: 0, exchangeCreditMinor: 0 } : null;
    if (entry) { entry.recordCount++; activity.set(branchId!, entry); }
    if (record.collection === "sales" && record.data.status === "completed") {
      const outstanding = record.data.receivableOutstandingMinor;
      const tracked = record.data.receivableVersion === 1 && money(outstanding);
      if (tracked && Number(outstanding) > 0 || !tracked && Number(record.data.creditAmountMinor ?? 0) > 0) {
        openInvoices.push({ id: record.id, number: String(record.data.saleNumber ?? record.data.receiptNumber ?? record.id), branchId, outstandingMinor: tracked ? Number(outstanding) : null, tracked });
        if (entry && tracked) entry.unpaidMinor += Number(outstanding);
      }
      if (outstanding !== undefined && !money(outstanding)) invalidAmounts = true;
    }
    if (record.collection === "salesCredits") {
      if (record.data.remainingAmountMinor !== undefined && !money(record.data.remainingAmountMinor)) invalidAmounts = true;
      if (entry && money(record.data.remainingAmountMinor)) entry.exchangeCreditMinor += Number(record.data.remainingAmountMinor);
    }
  }
  const outstandingMinor = money(customer.outstandingBalanceMinor ?? 0) ? Number(customer.outstandingBalanceMinor ?? 0) : null;
  const advances = customer.advanceBalances ?? {};
  const advanceBalances = advances && typeof advances === "object" && !Array.isArray(advances) ? Object.entries(advances) : [];
  if (!advances || typeof advances !== "object" || Array.isArray(advances) || advanceBalances.some(([, amount]) => !money(amount))) invalidAmounts = true;
  const advanceMinor = advanceBalances.reduce((sum, [, amount]) => sum + (money(amount) ? Number(amount) : 0), 0);
  const arrangements = Array.isArray(customer.arrangements) ? customer.arrangements.map(item => {
    const value = item as Record<string, unknown>;
    if (!value || typeof value !== "object" || !money(value.outstandingBalanceMinor)) invalidAmounts = true;
    return { id: String(value?.id ?? ""), name: String(value?.name ?? ""), outstandingMinor: money(value?.outstandingBalanceMinor) ? Number(value.outstandingBalanceMinor) : null };
  }) : [];
  const trackedUnpaidMinor = openInvoices.reduce((sum, invoice) => sum + (invoice.outstandingMinor ?? 0), 0);
  const totals = [...activity.values()];
  if (totals.length > 1) issues.push("cross_branch_history");
  if (currentBranchId && totals.some(entry => entry.branchId !== currentBranchId)) issues.push("history_owner_conflict");
  if (unattributedRecords) issues.push("unattributed_history");
  const financialReview = invalidAmounts || outstandingMinor === null || !Number.isSafeInteger(advanceMinor) || !Number.isSafeInteger(trackedUnpaidMinor) ||
    outstandingMinor !== trackedUnpaidMinor || outstandingMinor > 0 && openInvoices.some(invoice => !invoice.tracked) ||
    arrangements.reduce((sum, account) => sum + (account.outstandingMinor ?? 0), 0) > (outstandingMinor ?? 0) ||
    !records.length && advanceMinor > 0;
  if (financialReview) issues.push("balance_review_required");
  if (!complete) issues.push("review_limit");
  const blockers = issues.filter(issue => ["cross_branch_history", "unattributed_history", "balance_review_required", "review_limit"].includes(issue));
  const allowedTargetBranchIds = blockers.length ? [] : branches.filter(branch => branch.status === "active" && (!totals.length || totals[0]!.branchId === branch.id)).map(branch => branch.id);
  return { currentBranchId, currentBranchName: currentBranchId ? branchMap.get(currentBranchId)?.name ?? "Unknown branch" : "Unassigned", issues, blockers,
    needsReview: issues.length > 0, activity: totals.sort((a, b) => a.branchName.localeCompare(b.branchName)), unattributedRecords, recordCount: records.length,
    outstandingMinor, trackedUnpaidMinor, advanceMinor, advanceBalances: Object.fromEntries(advanceBalances), arrangements, openInvoices,
    allowedTargetBranchIds, complete };
}

import { HttpsError } from "firebase-functions/v2/https";

export interface CashJournal {
  id: string;
  type: string;
  referenceType?: string;
  referenceId?: string;
  activity?: string;
  pairedTransfer?: boolean;
}
export interface CashMovement { type: string; section: string; amountMinor: number }
const investing = new Set(["asset_purchase", "asset_disposal"]);
const financing = new Set(["capital_contribution", "loan_receipt", "loan_repayment", "dividend"]);
const sections = ["Operating activities", "Investing activities", "Financing activities", "Store funding transfers"] as const;
function safe(value: number) {
  if (!Number.isSafeInteger(value)) throw new HttpsError("failed-precondition", "Cash movement exceeds safe minor-unit arithmetic.");
  return value;
}

/** Group only the journal lines already authorized and included in this report. */
export function addCashMovement(groups: Map<string, CashMovement>, journal: CashJournal, movement: number) {
  safe(movement);
  const internal = journal.type === "internal_funds_transfer";
  const linked = journal.referenceType === "companyFundsTransfer" && typeof journal.referenceId === "string" && journal.referenceId.length > 0;
  if (internal && journal.pairedTransfer && !linked)
    throw new HttpsError("failed-precondition", "A paired company transfer has no shared reference. Reconcile it before issuing this statement.");
  if (journal.activity !== undefined && !["operating", "investing", "financing"].includes(journal.activity))
    throw new HttpsError("failed-precondition", "A journal cash-flow classification requires review.");
  const section = internal ? "Store funding transfers"
    : journal.activity ? ({ operating: sections[0], investing: sections[1], financing: sections[2] } as Record<string, string>)[journal.activity]!
      : investing.has(journal.type) ? sections[1]! : financing.has(journal.type) ? sections[2]! : sections[0]!;
  // Paired store journals share referenceId. Unrelated transfers must never net
  // merely because their journal types or human-readable references match.
  const key = internal && linked ? `transfer:${journal.referenceId}` : `journal:${journal.id}`;
  const previous = groups.get(key);
  groups.set(key, { type: journal.type, section, amountMinor: safe((previous?.amountMinor ?? 0) + movement) });
}

export function cashFlowRows(groups: Map<string, CashMovement>) {
  return sections.map(section => ({ section, amountMinor: [...groups.values()].filter(row => row.section === section).reduce((sum, row) => safe(sum + row.amountMinor), 0) }));
}

export function receiptsPayments(groups: Map<string, CashMovement>) {
  const totals = new Map<string, { section: string; accountName: string; amountMinor: number }>();
  for (const movement of groups.values()) {
    if (!movement.amountMinor) continue;
    const section = movement.amountMinor > 0 ? "Receipts" : "Payments", key = `${section}:${movement.type}`;
    totals.set(key, { section, accountName: movement.type === "internal_funds_transfer" ? "Store funding transfer" : movement.type.replaceAll("_", " "), amountMinor: safe((totals.get(key)?.amountMinor ?? 0) + Math.abs(movement.amountMinor)) });
  }
  const rows = [...totals.values()].sort((a, b) => a.accountName.localeCompare(b.accountName));
  const sum = (section: string) => rows.filter(row => row.section === section).reduce((total, row) => safe(total + row.amountMinor), 0);
  const receiptsMinor = sum("Receipts"), paymentsMinor = sum("Payments");
  return { rows, receiptsMinor, paymentsMinor, netCashMovementMinor: safe(receiptsMinor - paymentsMinor) };
}

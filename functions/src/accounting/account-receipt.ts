import { Timestamp } from "firebase-admin/firestore";

const money = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const text = (value: unknown): string | null => typeof value === "string" ? value : null;
export interface AccountReceiptEvidence {
  invoiceAllocations: Array<Record<string, unknown>>;
  outstandingAfterMinor?: unknown;
  advanceAfterMinor?: unknown;
}
/** Uses the original payment evidence only; never substitutes today's balances. */
export function accountReceipt(record: FirebaseFirestore.DocumentSnapshot, party: "customer" | "supplier", companyName: string, showControlBalances: boolean, evidence?: AccountReceiptEvidence) {
  const get = (key: string) => record.get(key);
  const noncash = get("source") === "advance_balance" || ["customer_advance", "supplier_advance"].includes(get("method"));
  const advance = get("advanceBalancesAfter");
  const advanceSnapshot = party === "customer" && advance && typeof advance === "object" && Object.values(advance).every(value => money(value) !== null)
    ? money(Object.values(advance).reduce((sum: number, value) => sum + Number(value), 0)) : money(get("advanceBalanceAfterMinor") === undefined ? evidence?.advanceAfterMinor : get("advanceBalanceAfterMinor"));
  const at = get("paidAt") ?? get("recordedAt") ?? get("createdAt");
  const parts: Record<string, unknown>[] = Array.isArray(get("tenders")) && get("tenders").length ? get("tenders") : get("method") === "customer_advance" || get("method") === "supplier_advance" ? [] : [{ method: get("method"), amountMinor: get("amountMinor"), bankName: get("bankName"), bankAccountName: get("bankAccountName"), accountNumberLast4: get("accountNumberLast4"), reference: get("reference") }];
  return {
    id: record.id, party, companyName, partyName: text(get(party === "customer" ? "customerName" : "supplierName")), partyNumber: text(get(party === "customer" ? "customerNumber" : "supplierNumber")),
    paymentNumber: text(get("paymentNumber")) ?? record.id, purpose: text(get("purpose")) ?? (party === "customer" ? "repayment" : "payment"),
    direction: text(get("direction")) ?? (noncash ? "non_cash" : get("purpose") === "advance_refund" ? party === "customer" ? "outflow" : "inflow" : party === "customer" ? "inflow" : "outflow"), source: text(get("source")),
    amountMinor: money(get("amountMinor")), at: at instanceof Timestamp ? at.toDate().toISOString() : null,
    journalEntryId: text(get("journalEntryId")), branchId: text(get("branchId")), warehouseId: text(get("warehouseId")),
    reference: text(get("reference")), notes: text(get("notes")),
    tenders: parts.map((part: Record<string, unknown>) => ({ method: text(part.method), amountMinor: money(part.amountMinor), bankName: text(part.bankName), accountName: text(part.bankAccountName), accountNumberLast4: text(part.accountNumberLast4), reference: text(part.reference) })),
    allocations: (Array.isArray(get("invoiceAllocations")) ? get("invoiceAllocations") : evidence?.invoiceAllocations ?? []).map((line: Record<string, unknown>) => ({ invoiceNumber: text(line.invoiceNumber) ?? text(line.saleNumber) ?? text(line.saleId) ?? text(line.supplierInvoiceId), amountMinor: money(line.amountMinor), outstandingAfterMinor: money(line.outstandingAfterMinor) })),
    arrangements: (Array.isArray(get("allocations")) ? get("allocations") : []).filter((line: Record<string, unknown>) => typeof line.accountId === "string").map((line: Record<string, unknown>) => ({ name: text(line.accountName) ?? text(line.accountId), amountMinor: money(line.amountMinor) })),
    outstandingAfterMinor: showControlBalances ? money(get("outstandingAfterMinor") === undefined ? evidence?.outstandingAfterMinor : get("outstandingAfterMinor")) : null,
    advanceAfterMinor: showControlBalances ? advanceSnapshot : null,
    balanceScope: showControlBalances ? "Organization-wide balances immediately after this transaction" : "Organization-wide balances are outside this receipt's permitted store scope",
  };
}

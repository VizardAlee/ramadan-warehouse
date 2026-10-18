import { nairaToKobo } from "@/features/inventory/format";
import type { OperatingExpense } from "@/types/domain";

export const expenseQueues = [
  { value: "all", label: "All bills" }, { value: "draft", label: "Drafts" },
  { value: "submitted", label: "Needs approval" }, { value: "ready", label: "Ready to pay" },
  { value: "paid", label: "Paid history" },
] as const;
export type ExpenseQueue = typeof expenseQueues[number]["value"];
export function expenseStatusLabel(status: OperatingExpense["status"]) {
  return { draft: "Draft · not posted", submitted: "Submitted · awaiting approval", approved: "Approved · unpaid", partially_paid: "Partially paid", paid: "Paid" }[status] ?? status;
}
export function expenseStatusHelp(status: OperatingExpense["status"]) {
  return {
    draft: "Review the bill, then submit it. A draft does not recognize an expense or record a payment.",
    submitted: "An authorized approver must approve this bill before payment can be recorded. Approval recognizes the expense and payable, not a bank payment.",
    approved: "This bill is approved and unpaid. Record only money already paid; this app does not initiate a bank transfer.",
    partially_paid: "Only part of this bill has been paid. Record the remaining actual payment separately, up to the outstanding amount.",
    paid: "This bill is fully paid. No further payment is available here.",
  }[status] ?? "Review the recorded status with authorized finance staff.";
}
export function eligibleExpenseAccounts<T extends { branchId?: string | null; ledgerAccountCode: string }>(accounts: T[], expense: { branchId?: string }) {
  return accounts.filter(account => Boolean(String(account.ledgerAccountCode ?? "").trim()) && (!account.branchId || account.branchId === expense.branchId));
}
export function expenseDraftAmounts(net: string, vat: string) {
  try {
    const netMinor = nairaToKobo(Number(net)), vatMinor = nairaToKobo(Number(vat || "0")), grossMinor = netMinor + vatMinor;
    return net.trim() && netMinor > 0 && vatMinor >= 0 && Number.isSafeInteger(grossMinor) ? { netMinor, vatMinor, grossMinor } : null;
  } catch { return null; }
}

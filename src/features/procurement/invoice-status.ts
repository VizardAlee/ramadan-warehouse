import type { SupplierInvoice } from "@/types/domain";

export function isInactiveInvoice(status: string) {
  return ["cancelled", "rejected", "void"].includes(status);
}
/** Presentation only: retain original invoice amounts in historical records. */
export function invoiceAmountDue(invoice: Pick<SupplierInvoice, "status" | "outstandingAmountMinor">) {
  return isInactiveInvoice(invoice.status) ? 0 : invoice.outstandingAmountMinor;
}

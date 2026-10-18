import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { accountReceipt } from "../functions/src/accounting/account-receipt";
import { customerHistoryInput } from "../functions/src/validation/sales";
import { procurementWorkspaceInput } from "../functions/src/validation/procurement";
const record = (data: Record<string, unknown>) => ({ id: "payment", get: (key: string) => data[key] }) as FirebaseFirestore.DocumentSnapshot;
describe("account receipt evidence", () => {
  it("prints saved allocations and balances without substituting current debt", () => {
    const receipt = accountReceipt(record({ customerName: "Amina", paymentNumber: "CRP-1", amountMinor: 10001, recordedAt: Timestamp.fromMillis(1000), tenders: [{ method: "cash", amountMinor: 3333 }, { method: "bank_transfer", amountMinor: 6668, bankName: "Bank", bankAccountName: "Operating", accountNumberLast4: "1234", reference: "BANK-1" }], invoiceAllocations: [{ saleId: "invoice", invoiceNumber: "SAL-1", amountMinor: 10001, outstandingAfterMinor: 5000 }], outstandingAfterMinor: 5000, advanceBalancesAfter: { general: 1234 } }), "customer", "Company", true);
    expect(receipt).toMatchObject({ paymentNumber: "CRP-1", amountMinor: 10001, outstandingAfterMinor: 5000, advanceAfterMinor: 1234, allocations: [{ invoiceNumber: "SAL-1", outstandingAfterMinor: 5000 }] });
    expect(receipt.tenders.map(part => part.amountMinor)).toEqual([3333, 6668]);
    expect(JSON.stringify(receipt)).not.toContain("bankAccountId");
  });
  it("leaves historic missing balances unknown and withholds global supplier balances for local readers", () => {
    const old = record({ method: "cash", amountMinor: 100, outstandingBalanceMinor: 999 });
    expect(accountReceipt(old, "customer", "Company", true)).toMatchObject({ outstandingAfterMinor: null, advanceAfterMinor: null, tenders: [{ amountMinor: 100 }] });
    expect(accountReceipt(record({ outstandingAfterMinor: 50000, advanceBalanceAfterMinor: 8000 }), "supplier", "Company", false)).toMatchObject({ outstandingAfterMinor: null, advanceAfterMinor: null });
    expect(accountReceipt(record({ source: "advance_balance", method: "customer_advance", amountMinor: 100 }), "customer", "Company", true).tenders).toEqual([]);
  });
  it("requires an exact safe recorded payment selector", () => {
    for (const paymentId of [undefined, "nested/id", ""]) {
      expect(customerHistoryInput.safeParse({ customerId: "c", view: "payment_receipt", paymentId }).success).toBe(false);
      expect(procurementWorkspaceInput.safeParse({ supplierId: "s", view: "supplier_payment_receipt", paymentId }).success).toBe(false);
    }
    expect(customerHistoryInput.safeParse({ customerId: "c", view: "payment_receipt", paymentId: "p" }).success).toBe(true);
    expect(procurementWorkspaceInput.safeParse({ supplierId: "s", view: "supplier_payment_receipt", paymentId: "p" }).success).toBe(true);
  });
});

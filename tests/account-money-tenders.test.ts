import { describe, expect, it } from "vitest";
import { tenderTotalError } from "../functions/src/accounting/money-tenders";
import { paymentTenders } from "../functions/src/accounting/payment-tenders";
import { customerPaymentInput } from "../functions/src/validation/sales";
import { recordSupplierPaymentInput } from "../functions/src/validation/procurement";
import { requestFingerprint } from "../functions/src/utils/request-fingerprint";

const key = "e7e4a31e-782c-4b2a-8a15-cc3b9e216b42";
const parts = [{ method: "cash" as const, amountMinor: 3333 }, { method: "bank_transfer" as const, bankAccountId: "company-bank", reference: "BANK-1", amountMinor: 6668 }];
const customer = { customerId: "customer", branchId: "branch", method: "cash" as const, amountMinor: 10001, idempotencyKey: key };
const supplier = { supplierId: "supplier", branchId: "branch", method: "cash" as const, allocations: [{ supplierInvoiceId: "invoice", amountMinor: 10001 }], paidAt: "2026-10-17T10:00:00Z", idempotencyKey: key };

describe("account money tenders", () => {
  it("keeps exact kobo totals for customer receipts and supplier disbursements", () => {
    expect(customerPaymentInput.safeParse({ ...customer, tenders: parts }).success).toBe(true);
    expect(recordSupplierPaymentInput.safeParse({ ...supplier, tenders: parts }).success).toBe(true);
    expect(tenderTotalError(parts, 10001)).toBeNull();
  });
  it("rejects underpayment, overpayment, fractional kobo and repeated payment references", () => {
    for (const tenders of [[...parts, { method: "cash" as const, amountMinor: 1 }], parts.slice(0, 1), [{ ...parts[0]!, amountMinor: 1.5 }], [parts[1], parts[1]]]) {
      expect(customerPaymentInput.safeParse({ ...customer, tenders }).success).toBe(false);
      expect(recordSupplierPaymentInput.safeParse({ ...supplier, tenders }).success).toBe(false);
    }
    expect(tenderTotalError([{ method: "cash", amountMinor: Number.MAX_SAFE_INTEGER }, { ...parts[1]!, amountMinor: 1 }], Number.MAX_SAFE_INTEGER)).toMatch(/safe/);
  });
  it("requires the actual account and reference for each noncash part", () => {
    for (const change of [{ reference: "" }, { bankAccountId: undefined }])
      expect(customerPaymentInput.safeParse({ ...customer, tenders: [parts[0], { ...parts[1]!, ...change }] }).success).toBe(false);
    expect(customerPaymentInput.safeParse({ ...customer, tenders: [{ method: "cash", amountMinor: 10001, bankAccountId: "bank" }] }).success).toBe(false);
  });
  it("keeps existing advance applications distinct from received or disbursed money", () => {
    expect(customerPaymentInput.safeParse({ ...customer, source: "advance_balance", tenders: parts }).success).toBe(false);
    expect(recordSupplierPaymentInput.safeParse({ ...supplier, source: "advance_balance", tenders: parts }).success).toBe(false);
    expect(customerPaymentInput.safeParse({ ...customer, purpose: "advance", tenders: parts }).success).toBe(true);
    expect(recordSupplierPaymentInput.safeParse({ ...supplier, purpose: "advance", allocations: [], amountMinor: 10001, tenders: parts }).success).toBe(true);
  });
  it("preserves legacy single-method inputs and binds new retries to each bank and reference", () => {
    expect(customerPaymentInput.safeParse(customer).success).toBe(true);
    expect(recordSupplierPaymentInput.safeParse(supplier).success).toBe(true);
    expect(paymentTenders(customer, customer.amountMinor)).toEqual([{ method: "cash", amountMinor: 10001 }]);
    const original = customerPaymentInput.parse({ ...customer, tenders: parts });
    expect(requestFingerprint(original)).not.toBe(requestFingerprint(customerPaymentInput.parse({ ...customer, tenders: [parts[0], { ...parts[1]!, bankAccountId: "another-bank" }] })));
  });
});

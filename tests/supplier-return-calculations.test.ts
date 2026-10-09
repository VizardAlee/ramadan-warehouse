import { describe, expect, it } from "vitest";
import { supplierReturnAmounts } from "../functions/src/inventory/supplier-return-calculations";
import { postSupplierReturnInput, postSupplierCreditDocumentInput } from "../functions/src/validation/procurement";
const base = { quantity: 3, netMinor: 300, vatMinor: 23, returnedQuantity: 0, returnedNetMinor: 0, returnedVatMinor: 0, returnQuantity: 1, outstandingMinor: 50, movementValueMinor: 95 };
describe("supplier-return invoice snapshots", () => {
  it("bounds multi-product documents and rejects duplicate products, receipts and retry references", () => {
    const line = { supplierInvoiceItemId: "line", receiptId: "receipt", quantity: 1, idempotencyKey: crypto.randomUUID() };
    const input = { supplierInvoiceId: "invoice", returnedAt: new Date().toISOString(), creditNoteReference: "CN-MULTI", reason: "Supplier approved both", idempotencyKey: crypto.randomUUID(), lines: [line] };
    expect(postSupplierCreditDocumentInput.parse(input).lines[0]!.serialNumbers).toEqual([]);
    for (const field of ["supplierInvoiceItemId", "receiptId", "idempotencyKey"] as const) {
      const other = { supplierInvoiceItemId: "second", receiptId: "second-receipt", quantity: 1, idempotencyKey: crypto.randomUUID(), [field]: line[field] };
      expect(postSupplierCreditDocumentInput.safeParse({ ...input, lines: [line, other] }).success).toBe(false);
    }
    expect(postSupplierCreditDocumentInput.safeParse({ ...input, lines: [] }).success).toBe(false);
    expect(postSupplierCreditDocumentInput.safeParse({ ...input, lines: Array.from({ length: 11 }, (_, index) => ({ ...line, supplierInvoiceItemId: `line-${index}`, receiptId: `receipt-${index}`, idempotencyKey: crypto.randomUUID() })) }).success).toBe(false);
    expect(postSupplierCreditDocumentInput.safeParse({ ...input, lines: [{ ...line, quantity: 0 }] }).success).toBe(false);
  });

  it("reduces debt first, creates surplus credit and preserves valuation variance", () => {
    expect(supplierReturnAmounts(base)).toMatchObject({ netMinor: 100, vatMinor: 8, grossMinor: 108, payableReductionMinor: 50, supplierCreditMinor: 58, valuationVarianceMinor: 5 });
  });
  it("allocates rounding cumulatively so all partial credits exactly equal original VAT", () => {
    const first = supplierReturnAmounts(base);
    const second = supplierReturnAmounts({ ...base, returnedQuantity: 1, returnedNetMinor: first.returnedNetMinor, returnedVatMinor: first.returnedVatMinor });
    const third = supplierReturnAmounts({ ...base, returnedQuantity: 2, returnedNetMinor: second.returnedNetMinor, returnedVatMinor: second.returnedVatMinor });
    expect(first.vatMinor + second.vatMinor + third.vatMinor).toBe(23);
    expect(third.returnedNetMinor).toBe(300);
    expect(third.returnedQuantity).toBe(3);
  });
  it("rejects over-returns, inconsistent history and unsafe amounts", () => {
    expect(() => supplierReturnAmounts({ ...base, returnQuantity: 4 })).toThrow();
    expect(() => supplierReturnAmounts({ ...base, returnedQuantity: 1 })).toThrow();
    expect(() => supplierReturnAmounts({ ...base, netMinor: Number.MAX_SAFE_INTEGER + 1 })).toThrow();
    expect(() => supplierReturnAmounts({ ...base, returnQuantity: 0.5 })).toThrow();
  });
  it("requires original references, reason and a credit-note reference", () => {
    const input = { supplierInvoiceId: "invoice", supplierInvoiceItemId: "line", receiptId: "receipt", quantity: 1, returnedAt: new Date().toISOString(), creditNoteReference: "CN-001", reason: "Damaged goods", idempotencyKey: crypto.randomUUID() };
    expect(postSupplierReturnInput.parse(input).serialNumbers).toEqual([]);
    expect(postSupplierReturnInput.safeParse({ ...input, reason: "", creditNoteReference: "" }).success).toBe(false);
  });
});

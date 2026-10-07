// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SaleDocumentDialog } from "@/features/pos/sale-document";
import type { SaleDocument } from "@/features/pos/types";

const document: SaleDocument = {
  official: true,
  organization: { legalName: "AB Ramadan Ltd", tradingName: null, registrationNumber: null, address: "Kano", contactEmail: null, phoneNumbers: [] },
  branch: { id: "hq", name: "Head Office", code: "HQ", address: "Kano", state: "Kano", contactPhone: null },
  sale: { id: "sale1", saleNumber: "SAL-HQ-1", invoiceNumber: "INV-HQ-1", receiptNumber: "RCP-HQ-1", paymentStatus: "paid", collectionStatus: "partially_collected", customerNumber: "CUS-1", customerName: "Amina", customerPhone: "08011223344", customerEmail: null, customerAddress: "Customer address", customerTaxId: null, netAmountMinor: 100000, subtotalAmountMinor: 100000, discountAmountMinor: 0, discountReason: null, vatAmountMinor: 0, grossAmountMinor: 100000, amountPaidMinor: 100000, creditAmountMinor: 0, currency: "NGN", recordedAt: "2026-10-07T10:00:00.000Z", postedAt: "2026-10-07T10:00:00.000Z" },
  items: [{ id: "item1", sku: "PANEL", productName: "Solar panel", unitOfMeasure: "unit", quantity: 10, collectedQuantity: 6, unitPriceMinor: 10000, subtotalAmountMinor: 100000, discountAmountMinor: 0, vatRateBasisPoints: 0, netAmountMinor: 100000, vatAmountMinor: 0, grossAmountMinor: 100000 }],
  payments: [{ id: "p1", method: "cash", amountMinor: 100000, reference: null, status: "confirmed" }],
  collections: [{ id: "collection1", waybillNumber: "WB-INV-2026-000021", referenceNumber: "SAL-HQ-1", collector: "Amina Musa", collectedAt: "2026-10-07T11:00:00.000Z", releasedBy: "staff1", releasedByName: "Usman", totalQuantity: 6, notes: "Four units remain reserved", lines: [{ saleItemId: "item1", productName: "Solar panel", sku: "PANEL", quantity: 6, unitOfMeasure: "unit" }] }],
};
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("collection waybill", () => {
  it("prints the actual handover, not the whole paid invoice, without changing stock", () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    render(<SaleDocumentDialog document={document} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "View waybill" }));
    const waybill = screen.getByRole("dialog", { name: "Collection waybill" });
    expect(waybill.textContent).toContain("WB-INV-2026-000021");
    expect(waybill.textContent).toContain("6 unit");
    expect(waybill.textContent).not.toContain("10 unit");
    expect(waybill.textContent).toContain("Usman");
    expect(waybill.textContent).toContain("Amina Musa");
    expect(waybill.textContent).not.toContain("Invoice total");
    fireEvent.click(screen.getByRole("button", { name: "Print waybill / save PDF" }));
    fireEvent.click(screen.getByRole("button", { name: "Print waybill / save PDF" }));
    expect(print).toHaveBeenCalledTimes(2);
    expect(document.items[0]!.collectedQuantity).toBe(6);
    fireEvent.click(screen.getByRole("button", { name: "Back to invoice" }));
    expect(screen.getByText("Invoice total")).toBeTruthy();
  });
  it("cannot issue a waybill for a provisional offline sale or uncollected reservation", () => {
    const view = render(<SaleDocumentDialog document={{ ...document, official: false }} onClose={() => {}} />);
    expect(screen.queryByRole("button", { name: "View waybill" })).toBeNull();
    view.rerender(<SaleDocumentDialog document={{ ...document, collections: [] }} onClose={() => {}} />);
    expect(screen.queryByRole("button", { name: "View waybill" })).toBeNull();
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SaleDocumentDialog } from "@/features/pos/sale-document";
import type { SaleDocument } from "@/features/pos/types";
const access = vi.hoisted(() => ({ mayRecordCosts: false }));
const api = vi.hoisted(() => vi.fn());
vi.mock("@/features/administration/api", () => ({ callAdministration: api }));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => ({ profile: { organizationId: "org" } }) }));
vi.mock("@/lib/permissions/roles", () => ({ hasPermission: () => access.mayRecordCosts }));

const document: SaleDocument = {
  official: true,
  organization: { legalName: "AB Ramadan Ltd", tradingName: null, registrationNumber: null, address: "Kano", contactEmail: null, phoneNumbers: [] },
  branch: { id: "hq", name: "Head Office", code: "HQ", address: "Kano", state: "Kano", contactPhone: null },
  sale: { id: "sale1", saleNumber: "SAL-HQ-1", invoiceNumber: "INV-HQ-1", receiptNumber: "RCP-HQ-1", paymentStatus: "paid", collectionStatus: "partially_collected", customerNumber: "CUS-1", customerName: "Amina", customerPhone: "08011223344", customerEmail: null, customerAddress: "Customer address", customerTaxId: null, netAmountMinor: 100000, subtotalAmountMinor: 100000, discountAmountMinor: 0, discountReason: null, vatAmountMinor: 0, grossAmountMinor: 100000, amountPaidMinor: 100000, creditAmountMinor: 0, currency: "NGN", recordedAt: "2026-10-07T10:00:00.000Z", postedAt: "2026-10-07T10:00:00.000Z" },
  items: [{ id: "item1", sku: "PANEL", productName: "Solar panel", unitOfMeasure: "unit", quantity: 10, collectedQuantity: 6, unitPriceMinor: 10000, subtotalAmountMinor: 100000, discountAmountMinor: 0, vatRateBasisPoints: 0, netAmountMinor: 100000, vatAmountMinor: 0, grossAmountMinor: 100000 }],
  payments: [{ id: "p1", method: "cash", amountMinor: 100000, reference: null, status: "confirmed" }],
  collections: [{ id: "collection1", waybillNumber: "WB-INV-2026-000021", referenceNumber: "SAL-HQ-1", collector: "Amina Musa", collectedAt: "2026-10-07T11:00:00.000Z", releasedBy: "staff1", releasedByName: "Usman", totalQuantity: 6, notes: "Four units remain reserved", lines: [{ saleItemId: "item1", productName: "Solar panel", sku: "PANEL", quantity: 6, unitOfMeasure: "unit" }] }],
};
afterEach(() => { cleanup(); vi.restoreAllMocks(); api.mockReset(); access.mayRecordCosts = false; });

describe("collection waybill", () => {
  it("pages older handovers and prints their actual quantities without changing the invoice", async () => {
    const older = { ...document.collections![0]!, id: "old", collector: "Older collector", totalQuantity: 2,
      lines: [{ productName: "Solar panel", quantity: 2, unitOfMeasure: "unit" }] };
    api.mockResolvedValueOnce({ ...document, collections: [older], collectionsNextCursorId: null })
      .mockResolvedValueOnce({ ...document, collectionsNextCursorId: "collection1" });
    render(<SaleDocumentDialog document={{ ...document, collectionsNextCursorId: "collection1" }} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Older collections" }));
    await waitFor(() => expect(screen.getByText(/2 collected by Older collector/)).toBeTruthy());
    expect(api).toHaveBeenLastCalledWith("getSaleDocument", { saleId: "sale1", collectionLimit: 25, collectionCursorId: "collection1" });
    fireEvent.click(screen.getByRole("button", { name: "View waybill" }));
    expect(screen.getByRole("dialog", { name: "Collection waybill" }).textContent).toContain("2 unit");
    fireEvent.click(screen.getByRole("button", { name: "Back to invoice" }));
    fireEvent.click(screen.getByRole("button", { name: "Newer collections" }));
    await waitFor(() => expect(screen.getByText(/6 collected by Amina Musa/)).toBeTruthy());
    expect(api).toHaveBeenLastCalledWith("getSaleDocument", { saleId: "sale1", collectionLimit: 25 });
  });
  it("keeps the current page after a failed or mismatched history response", async () => {
    api.mockResolvedValue({ ...document, sale: { ...document.sale, id: "other-sale" } });
    render(<SaleDocumentDialog document={{ ...document, collectionsNextCursorId: "collection1" }} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Older collections" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("does not belong"));
    expect(screen.getByText(/6 collected by Amina Musa/)).toBeTruthy();
  });
  it("links authorized provider costs to the actual sale and never to an offline provisional invoice", () => {
    access.mayRecordCosts = true;
    const view = render(<SaleDocumentDialog document={document} onClose={() => {}} />);
    expect(screen.getByRole("link", { name: "Record delivery / service provider cost" }).getAttribute("href")).toBe("/expenses?saleId=sale1&branchId=hq");
    view.rerender(<SaleDocumentDialog document={{ ...document, official: false }} onClose={() => {}} />);
    expect(screen.queryByRole("link", { name: "Record delivery / service provider cost" })).toBeNull();
    access.mayRecordCosts = false;
    view.rerender(<SaleDocumentDialog document={document} onClose={() => {}} />);
    expect(screen.queryByRole("link", { name: "Record delivery / service provider cost" })).toBeNull();
  });
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

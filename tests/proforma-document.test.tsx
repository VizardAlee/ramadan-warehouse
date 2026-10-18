// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ProformaDocument, type Proforma } from "@/features/pos/proforma-document";
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const quote: Proforma = { id: "quote", branchId: "a", branchName: "Store A", companyName: "Company", companyAddress: null, customerId: "customer", customerName: "Customer", number: "PF-1", createdAt: "2026-10-17T10:00:00Z", validUntil: "2099-01-01", expiresAt: "2099-01-01T22:59:59Z", notes: "Review before purchase", discountReason: null, subtotalAmountMinor: 10001, discountAmountMinor: 0, netAmountMinor: 10001, vatAmountMinor: 750, grossAmountMinor: 10751, lines: [{ productId: "product", productName: "Product", sku: "SKU", quantity: 1, unitOfMeasure: "unit", priceTier: "retail", unitPriceMinor: 10001, vatAmountMinor: 750, grossAmountMinor: 10751 }] };
it("reprints a clearly nonposting quotation without calling a financial operation", async () => {
  const print = vi.spyOn(window, "print").mockImplementation(() => {});
  render(<ProformaDocument quote={quote} canConvert onClose={() => {}} />);
  expect(screen.getByRole("dialog", { name: "Proforma quotation" }).textContent).toContain("Not a tax invoice, payment receipt or stock-release document");
  expect((await screen.findByRole("link", { name: "Review as new POS sale" })).getAttribute("href")).toBe("/pos?proformaId=quote");
  fireEvent.click(screen.getByRole("button", { name: "Print proforma / save PDF" }));
  fireEvent.click(screen.getByRole("button", { name: "Print proforma / save PDF" }));
  expect(print).toHaveBeenCalledTimes(2);
});
it("allows historic printing while withholding expired or unauthorized conversion", () => {
  const view = render(<ProformaDocument quote={{ ...quote, expiresAt: "2000-01-01T00:00:00Z" }} canConvert onClose={() => {}} />);
  expect(screen.queryByRole("link", { name: "Review as new POS sale" })).toBeNull();
  expect(screen.getByRole("button", { name: "Print proforma / save PDF" })).toBeTruthy();
  view.rerender(<ProformaDocument quote={quote} canConvert={false} onClose={() => {}} />);
  expect(screen.queryByRole("link", { name: "Review as new POS sale" })).toBeNull();
});

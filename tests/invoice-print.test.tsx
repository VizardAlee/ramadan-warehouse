// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { SaleDocumentDialog } from "@/features/pos/sale-document";
import { fitInvoiceToPage } from "@/features/pos/invoice-print";
import type { SaleDocument } from "@/features/pos/types";
vi.mock("next/image", () => ({ default: (props: Record<string, unknown>) => createElement("img", { ...props, alt: String(props.alt) }) }));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => ({ profile: null }) }));
afterEach(cleanup);
function invoice(count: number): SaleDocument {
  return {
    official: true, organization: { legalName: "AB Ramadan Warehouse", tradingName: null, registrationNumber: "RC-123456", address: "12 Warehouse Road, Kano", contactEmail: "accounts@example.test", phoneNumbers: ["08012345678"] },
    branch: { id: "b1", name: "Kano Store", code: "KN", address: "12 Warehouse Road", state: "Kano", contactPhone: "08012345678" },
    sale: { id: "s1", saleNumber: "SALE-001", invoiceNumber: "INV-001", receiptNumber: "REC-001", paymentStatus: "part_paid", customerNumber: "CUS-001", customerName: "Statement Test Customer", customerPhone: "08087654321", customerEmail: "customer@example.test", customerAddress: "34 Market Street, Kano", customerTaxId: null, netAmountMinor: count * 100000, subtotalAmountMinor: count * 100000, discountAmountMinor: 0, discountReason: null, vatAmountMinor: count * 7500, grossAmountMinor: count * 107500, amountPaidMinor: count * 100000, creditAmountMinor: count * 7500, currency: "NGN", recordedAt: "2026-10-10T09:00:00Z", postedAt: "2026-10-10T09:00:00Z" },
    items: Array.from({ length: count }, (_, index) => ({ id: `item-${index}`, sku: `SKU-${index + 1}`, productName: `Warehouse product ${index + 1}`, unitOfMeasure: "pcs", quantity: 1, unitPriceMinor: 100000, subtotalAmountMinor: 100000, discountAmountMinor: 0, vatRateBasisPoints: 750, netAmountMinor: 100000, vatAmountMinor: 7500, grossAmountMinor: 107500 })),
    payments: [{ id: "p1", method: "bank_transfer", amountMinor: count * 100000, reference: "BANK-123", status: "completed" }],
  };
}
describe("invoice printing", () => {
  it("shrinks a tall invoice and restores scale for a short invoice", () => {
    const element = document.createElement("section");
    Object.defineProperty(element, "scrollHeight", { value: 2000, configurable: true });
    fitInvoiceToPage(element);
    expect(Number(element.style.getPropertyValue("--invoice-print-scale"))).toBeCloseTo(0.4913, 3);
    expect(element.hasAttribute("data-measure-print")).toBe(false);
    Object.defineProperty(element, "scrollHeight", { value: 700 });
    fitInvoiceToPage(element);
    expect(element.style.getPropertyValue("--invoice-print-scale")).toBe("1");
  });
  it("retains service, provider and included-part evidence on a mixed printable invoice", () => {
    const mixed = invoice(35); mixed.sale.providerFundsMinor = 50000; mixed.sale.priorServicePaidMinor = 107500; mixed.sale.grossAmountMinor += 50000;
    mixed.items[0] = { ...mixed.items[0]!, itemKind: "service", aftersalesCaseId: "CASE-ORIGINAL", includedParts: [{ productName: "Included cable", quantity: 2, serialNumbers: [] }], providerFunds: { supplierId: "provider", supplierName: "Existing carrier", amountMinor: 50000 } };
    render(<SaleDocumentDialog document={mixed} onClose={() => {}}/>); const printable = document.querySelector<HTMLElement>("[data-invoice-document]")!;
    expect(printable.textContent).toContain("CASE-ORIGINAL"); expect(printable.textContent).toContain("Included cable × 2"); expect(printable.textContent).toContain("Existing carrier"); expect(printable.querySelectorAll("tbody tr")).toHaveLength(35);
    if (process.env.INVOICE_PRINT_FIXTURE_DIR) { mkdirSync(process.env.INVOICE_PRINT_FIXTURE_DIR, { recursive: true }); writeFileSync(`${process.env.INVOICE_PRINT_FIXTURE_DIR}/invoice-mixed.html`, `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="invoice.css"></head><body>${document.querySelector("[data-sale-document-overlay]")!.outerHTML}<script>window.addEventListener('beforeprint', () => (${fitInvoiceToPage.toString()})(document.querySelector('[data-invoice-document]')))</script></body></html>`); }
  });
  it.each([3, 15, 35])("keeps all %i invoice items in the printable document", count => {
    render(<SaleDocumentDialog document={invoice(count)} onClose={() => {}} />);
    const element = document.querySelector<HTMLElement>("[data-invoice-document]")!;
    expect(element.querySelectorAll("tbody tr")).toHaveLength(count);
    window.dispatchEvent(new Event("beforeprint"));
    expect(element.style.getPropertyValue("--invoice-print-scale")).toBe("1");
    if (process.env.INVOICE_PRINT_FIXTURE_DIR) {
      mkdirSync(process.env.INVOICE_PRINT_FIXTURE_DIR, { recursive: true });
      writeFileSync(`${process.env.INVOICE_PRINT_FIXTURE_DIR}/invoice-${count}.html`, `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="invoice.css"></head><body><main style="height:2000px">Background app content must not print</main>${document.querySelector("[data-sale-document-overlay]")!.outerHTML}<script>window.addEventListener('beforeprint', () => (${fitInvoiceToPage.toString()})(document.querySelector('[data-invoice-document]')))</script></body></html>`);
    }
  });
});

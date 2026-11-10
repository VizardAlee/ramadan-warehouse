// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { availableForMatching, SupplierInvoiceMatch } from "@/features/procurement/supplier-invoice-match";
import { FinancialPrivacyProvider, privacyStorageKey } from "@/features/finance/financial-privacy";
import type { PurchaseOrderItem } from "@/types/domain";

const item: PurchaseOrderItem = { id: "line", purchaseOrderId: "po", productId: "product", productName: "Panel", sku: "P", trackingType: "quantity", unitOfMeasure: "unit", orderedQuantity: 5, receivedQuantity: 4, invoicedQuantity: 1, unitCostMinor: 123456, vatRateBasisPoints: 750 };
afterEach(() => { cleanup(); localStorage.clear(); });
const button = () => screen.getByRole("button", { name: "Match received goods to invoice" }) as HTMLButtonElement;
function prepare() {
  const onMatch = vi.fn(async () => {});
  const view = render(<SupplierInvoiceMatch items={[item]} busy={false} onMatch={onMatch} />);
  fireEvent.change(screen.getByLabelText("Supplier invoice number"), { target: { value: "INV-1" } });
  return { onMatch, ...view };
}
function price(value: string) { fireEvent.change(screen.getByLabelText("Actual supplier unit price (₦) for Panel"), { target: { value } }); }
function confirm() { fireEvent.click(screen.getByRole("checkbox")); }
describe("supplier invoice price review", () => {
  it("requires actual prices and quantity/VAT confirmation, then preserves matching API quantities", async () => {
    const { onMatch } = prepare();
    expect((screen.getByLabelText("Actual supplier unit price (₦) for Panel") as HTMLInputElement).value).toBe("");
    expect(button().disabled).toBe(true);
    price("1234.56");
    expect(button().disabled).toBe(true);
    confirm();
    expect(button().disabled).toBe(false);
    fireEvent.click(button());
    await waitFor(() => expect(onMatch).toHaveBeenCalledTimes(1));
    expect(onMatch).toHaveBeenCalledWith(expect.objectContaining({ supplierInvoiceNumber: "INV-1", lines: [{ purchaseOrderItemId: "line", quantity: 3 }] }));
  });
  it.each(["1234.57", "1234.55"])("blocks higher and lower prices (%s), without saving", value => {
    const { onMatch } = prepare(); price(value); confirm();
    expect(screen.getByRole("alert").textContent).toContain("Nothing has been submitted or saved");
    expect(screen.getByRole("status").textContent).toContain("Review required");
    expect(button().disabled).toBe(true); fireEvent.click(button()); expect(onMatch).not.toHaveBeenCalled();
  });
  it.each(["", "1234.561", "-1"])("blocks missing or invalid prices (%s)", value => {
    const { onMatch } = prepare(); price(value); confirm(); fireEvent.click(button());
    expect(button().disabled).toBe(true); expect(onMatch).not.toHaveBeenCalled();
  });
  it("clears confirmation on price edits and requires valid date ordering", () => {
    prepare(); price("1234.56"); confirm(); price("1234.57"); price("1234.56");
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    confirm(); fireEvent.change(screen.getByLabelText("Payment due date (optional)"), { target: { value: "2000-01-01" } });
    expect(button().disabled).toBe(true);
  });
  it("does not invoice already matched lines and resets when reopened", () => {
    const { rerender, onMatch } = prepare(); price("1234.56"); confirm();
    rerender(<SupplierInvoiceMatch key="new" items={[{ ...item, invoicedQuantity: 4 }]} busy={false} onMatch={onMatch} />);
    expect(screen.queryByLabelText("Actual supplier unit price (₦) for Panel")).toBeNull();
    expect(button().disabled).toBe(true);
    rerender(<SupplierInvoiceMatch key="reopened" items={[item]} busy={false} onMatch={onMatch} />);
    expect((screen.getByLabelText("Actual supplier unit price (₦) for Panel") as HTMLInputElement).value).toBe("");
  });
  it.each([
    { ...item, unitCostMinor: NaN },
    { ...item, unitCostMinor: Number.MAX_SAFE_INTEGER },
    { ...item, receivedQuantity: Infinity },
  ])("blocks malformed or overflowing order amounts", malformed => {
    const onMatch = vi.fn(async () => {});
    render(<SupplierInvoiceMatch items={[malformed]} busy={false} onMatch={onMatch} />);
    fireEvent.change(screen.getByLabelText("Supplier invoice number"), { target: { value: "INV" } }); price("1234.56"); confirm();
    expect(button().disabled).toBe(true); fireEvent.click(button()); expect(onMatch).not.toHaveBeenCalled();
  });
  it("blocks an overflowing actual line total", () => {
    prepare(); price("90071992547409.90"); confirm();
    expect(button().disabled).toBe(true);
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("blocks one-character invoice references", () => {
    prepare(); price("1234.56"); confirm();
    fireEvent.change(screen.getByLabelText("Supplier invoice number"), { target: { value: "I" } });
    expect(button().disabled).toBe(true);
  });
  it("removes actual prices and variance amounts from the DOM when privacy is enabled", async () => {
    const key = privacyStorageKey("org", "user");
    localStorage.setItem(key, JSON.stringify({ version: 1, hidden: false }));
    const view = render(<FinancialPrivacyProvider organizationId="org" uid="user"><SupplierInvoiceMatch items={[item]} busy={false} onMatch={vi.fn(async () => {})} /></FinancialPrivacyProvider>);
    await screen.findByLabelText("Actual supplier unit price (₦) for Panel");
    price("2345.67");
    expect(view.container.innerHTML).toContain("2,345.67");
    await act(async () => {
      localStorage.setItem(key, JSON.stringify({ version: 1, hidden: true }));
      window.dispatchEvent(new StorageEvent("storage", { key }));
    });
    expect(view.container.querySelector("[data-financial-input] input")).toBeNull();
    for (const amount of ["2,345.67", "1,234.56", "1,111.11", "3,333.33", "7.5"]) expect(view.container.innerHTML).not.toContain(amount);
    expect(view.container.innerHTML).toContain("Financial value hidden");
  });
  it("locks repeated submits until the pending request finishes", async () => {
    let finish!: () => void;
    const onMatch = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    render(<SupplierInvoiceMatch items={[item]} busy={false} onMatch={onMatch} />);
    fireEvent.change(screen.getByLabelText("Supplier invoice number"), { target: { value: "INV" } }); price("1234.56"); confirm();
    fireEvent.click(button()); fireEvent.click(button()); expect(onMatch).toHaveBeenCalledTimes(1); finish();
  });
});

describe("available supplier invoice quantities", () => {
  it("subtracts pending reservations when explicit matchable evidence is absent", () => {
    expect(availableForMatching({ ...item, pendingInvoiceQuantity: 2 })).toBe(1);
    expect(availableForMatching({ ...item, pendingInvoiceQuantity: 4 })).toBe(0);
  });
  it("uses the authoritative matchable quantity when supplied", () => {
    expect(availableForMatching({ ...item, pendingInvoiceQuantity: 1, matchableQuantity: 1 })).toBe(1);
  });
});

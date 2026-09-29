// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SalePriceDialog } from "@/features/pos/sale-price-dialog";

afterEach(() => cleanup());

function PriceHarness({ onApply }: { onApply: () => void }) {
  const [price, setPrice] = useState("8550000");
  const [reason, setReason] = useState("");
  return <SalePriceDialog
    productName="Lithium Ion 5kwh Haisic"
    currentPriceMinor={85_000_000}
    salePrice={price}
    reason={reason}
    onPriceChange={setPrice}
    onReasonChange={setReason}
    onApply={onApply}
    onCancel={() => undefined}
    formRef={null}
  />;
}

describe("one-sale price dialog", () => {
  it("explains the missing audit reason instead of disabling Apply", () => {
    const apply = vi.fn();
    render(<PriceHarness onApply={apply} />);
    expect(screen.getByText("New price for this sale: ₦8,550,000.00")).toBeTruthy();
    const button = screen.getByRole("button", { name: "Apply to sale" });
    expect(button.hasAttribute("disabled")).toBe(false);
    expect(screen.getByText(/Reason for price change/).textContent).toContain("required");
    fireEvent.click(button);
    expect(apply).not.toHaveBeenCalled();
  });

  it("accepts a one-tap reason and applies the changed price", () => {
    const apply = vi.fn();
    render(<PriceHarness onApply={apply} />);
    fireEvent.click(screen.getByRole("button", { name: "Agreed customer price" }));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Agreed customer price");
    fireEvent.click(screen.getByRole("button", { name: "Apply to sale" }));
    expect(apply).toHaveBeenCalledOnce();
  });

  it("accepts a lower custom price with a typed reason", () => {
    const apply = vi.fn();
    render(<PriceHarness onApply={apply} />);
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "800000" } });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Customer-negotiated price" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply to sale" }));
    expect(apply).toHaveBeenCalledOnce();
  });
});

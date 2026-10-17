// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PosProductCard } from "@/features/pos/product-card";
import type { PosProduct } from "@/features/pos/types";

const product: PosProduct = { id: "demo", sku: "LONG-SKU-".repeat(12), name: "Long battery and inverter catalogue description ".repeat(8), unitOfMeasure: "unit", trackingType: "quantity", unitPriceMinor: 85_000_000, basePriceMinor: 85_000_000, vatRateBasisPoints: 0, priceVersion: 1, priceSource: "central", availableQuantity: 0 };
afterEach(cleanup);

describe("POS compact catalogue guidance", () => {
  it("keeps 40 unavailable products compact, with complete names and individually expandable reasons", () => {
    const add = vi.fn();
    render(<>{Array.from({ length: 40 }, (_, i) => <PosProductCard key={i} product={{ ...product, id: String(i), name: `${i} ${product.name}` }} available={0} pending={false} ready online onAdd={add} />)}</>);
    expect(screen.getAllByText("Out of stock")).toHaveLength(40);
    for (const article of screen.getAllByRole("article")) {
      expect((within(article).getByRole("button", { name: "Add", exact: true }) as HTMLButtonElement).disabled).toBe(true);
      expect(article.querySelector("details")!.open).toBe(false);
      expect(within(article).getByRole("heading").textContent).toContain(product.name);
    }
    const help = screen.getAllByText("Why unavailable?")[0].closest("details")!;
    help.open = true;
    expect(help.textContent).toContain("Changing a price does not create stock");
    fireEvent.click(screen.getAllByRole("button", { name: "Add", exact: true })[0]);
    expect(add).not.toHaveBeenCalled();
  });

  it("preserves all concurrent blockers and distinguishes queued stock from branch stock", () => {
    render(<PosProductCard product={{ ...product, availableQuantity: 3 }} available={0} pending ready={false} online onAdd={vi.fn()} />);
    const help = screen.getByText("Why unavailable?").closest("details")!;
    expect(help.textContent).toContain("used by this device's queued orders");
    expect(help.textContent).toContain("unconfirmed result");
    expect(help.textContent).toContain("restoring its saved order state");
    expect(help.textContent).not.toContain("no available stock at this selling branch");
  });

  it("keeps services unavailable offline and allows available goods offline", () => {
    const add = vi.fn();
    const props = { product: { ...product, itemKind: "service" as const }, available: 100_000, pending: false, ready: true, online: false, onAdd: add };
    const view = render(<PosProductCard {...props} />);
    expect(screen.getByText("Internet required")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Add", exact: true }) as HTMLButtonElement).disabled).toBe(true);
    view.rerender(<PosProductCard {...props} product={{ ...product, availableQuantity: 3 }} available={3} />);
    fireEvent.click(screen.getByRole("button", { name: "Add", exact: true }));
    expect(add).toHaveBeenCalledOnce();
    expect(screen.queryByText("Why unavailable?")).toBeNull();
  });
});

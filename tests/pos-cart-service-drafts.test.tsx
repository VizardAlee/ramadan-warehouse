// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppDialog } from "@/components/ui/app-dialog";
import { useDialogFocus } from "@/components/ui/use-dialog-focus";
import { PosCartSurface } from "@/features/pos/cart-surface";
import { ServiceLineOptions } from "@/features/pos/service-line-options";
import { ActionGuidanceProvider } from "@/features/guidance/action-guidance";
import type { PosProduct, PosWorkspace } from "@/features/pos/types";

const api = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/features/administration/api", () => ({ callAdministration: api.call }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

const service: PosProduct = { id: "service", name: "Installation", sku: "SERVICE", itemKind: "service", trackingType: "quantity", unitOfMeasure: "job", unitPriceMinor: 1000, basePriceMinor: 1000, vatRateBasisPoints: 750, priceVersion: 1, priceSource: "central", availableQuantity: 0 };
const part: PosProduct = { ...service, id: "part", name: "Included cable", itemKind: "goods", availableQuantity: 10 };
const workspace: PosWorkspace = { branch: { id: "branch", name: "Test branch", code: "TEST" }, location: { id: "stock", name: "Test stock" }, products: [service, part], providers: [{ id: "provider", name: "Existing carrier", supplierType: "logistics" }], providerNextCursorId: "provider", customers: [], salesCredits: [], bankAccounts: [], pendingOrders: [], openShift: null, refreshedAt: "2026-10-17T00:00:00Z" };

function ServiceCart({ desktop = false, onChange }: { desktop?: boolean; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  const customerRef = useDialogFocus<HTMLElement>(customerOpen, () => setCustomerOpen(false));
  return <ActionGuidanceProvider pathname="/pos" profile={null}><main>
    <button onClick={() => setOpen(true)}>Open cart</button>
    <PosCartSurface open={open} focusActive={!customerOpen} onClose={() => setOpen(false)}>
      <aside hidden={!open && !desktop} role={open ? "dialog" : undefined} aria-label="Current sale">
        <button onClick={() => setOpen(false)}>Close cart</button>
        <ServiceLineOptions line={{ product: service, quantity: 1 }} workspace={workspace} customerId="" online onChange={onChange} />
        <button onClick={() => setCustomerOpen(true)}>Open customer dialog</button>
      </aside>
    </PosCartSurface>
    {customerOpen && <AppDialog className="app-dialog-backdrop-high" role="dialog" aria-label="Customer details">
      <section ref={customerRef}><button onClick={() => setCustomerOpen(false)}>Close customer dialog</button></section>
    </AppDialog>}
  </main></ActionGuidanceProvider>;
}

describe("POS cart service draft preservation", () => {
  it("retains unapplied provider/amount/part/case drafts, loaded pages and disclosure across close/reopen", async () => {
    const change = vi.fn();
    api.call.mockResolvedValue({ providers: [{ id: "provider-2", name: "Later supplier", supplierType: "mixed" }], nextCursorId: "provider-2" });
    render(<StrictMode><ServiceCart onChange={change} /></StrictMode>);
    fireEvent.click(screen.getByRole("button", { name: "Open cart" }));
    const details = screen.getByText("Service billing details").closest("details")!;
    fireEvent.click(screen.getByText("Service billing details"));
    fireEvent.click(screen.getByRole("button", { name: "Load more existing suppliers" }));
    await screen.findByRole("option", { name: /Later supplier/ });
    const provider = screen.getByLabelText("Delivery/service provider") as HTMLSelectElement;
    const amount = screen.getByLabelText("Provider funds (₦), separate from company fee") as HTMLInputElement;
    const selectedPart = screen.getByLabelText("Physical part included in fee") as HTMLSelectElement;
    const serviceCase = screen.getByLabelText("Optional confirmed aftersales case ID") as HTMLInputElement;
    fireEvent.change(provider, { target: { value: "provider-2" } });
    fireEvent.change(amount, { target: { value: "123.45" } });
    fireEvent.change(selectedPart, { target: { value: "part" } });
    fireEvent.change(serviceCase, { target: { value: "CASE-DRAFT-7" } });
    for (let repeat = 0; repeat < 2; repeat++) {
      fireEvent.click(screen.getByRole("button", { name: "Close cart" }));
      fireEvent.click(screen.getByRole("button", { name: "Open cart" }));
      expect((screen.getByLabelText("Delivery/service provider") as HTMLSelectElement).value).toBe("provider-2");
      expect(screen.getByLabelText("Delivery/service provider")).toBe(provider);
      expect((screen.getByLabelText("Provider funds (₦), separate from company fee") as HTMLInputElement).value).toBe("123.45");
      expect((screen.getByLabelText("Physical part included in fee") as HTMLSelectElement).value).toBe("part");
      expect((screen.getByLabelText("Optional confirmed aftersales case ID") as HTMLInputElement).value).toBe("CASE-DRAFT-7");
      expect(details.open).toBe(true);
    }
    expect(change).not.toHaveBeenCalled();
    expect(api.call).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Load more existing suppliers" }));
    expect(api.call).toHaveBeenLastCalledWith("getServiceBillingCase", { action: "providers", cursorId: "provider-2" });
    await waitFor(() => expect((provider.closest("fieldset") as HTMLFieldSetElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Apply provider funds" }));
    expect(change).toHaveBeenCalledWith(expect.objectContaining({ providerFunds: { supplierId: "provider-2", amountMinor: 12345 } }));
  });

  it("keeps the service subtree through desktop/mobile changes and suspends only cart focus for a nested dialog", () => {
    const change = vi.fn();
    const view = render(<ServiceCart onChange={change} />);
    fireEvent.click(screen.getByRole("button", { name: "Open cart" }));
    fireEvent.click(screen.getByText("Service billing details"));
    const serviceCase = screen.getByLabelText("Optional confirmed aftersales case ID") as HTMLInputElement;
    fireEvent.change(serviceCase, { target: { value: "CASE-RESIZE" } });
    view.rerender(<ServiceCart desktop onChange={change} />);
    fireEvent(window, new Event("resize"));
    expect(screen.getByLabelText("Optional confirmed aftersales case ID")).toBe(serviceCase);
    fireEvent.click(screen.getByRole("button", { name: "Open customer dialog" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close customer dialog" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Customer details" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Current sale" })).toBeTruthy();
    expect(serviceCase.value).toBe("CASE-RESIZE");
    fireEvent.click(screen.getByRole("button", { name: "Close cart" }));
    expect(serviceCase.closest(".app-dialog-backdrop")).toBeNull();
    expect(serviceCase.isConnected).toBe(true);
    view.rerender(<ServiceCart onChange={change} />);
    fireEvent(window, new Event("resize"));
    fireEvent.click(screen.getByRole("button", { name: "Open cart" }));
    expect(screen.getByLabelText("Optional confirmed aftersales case ID")).toBe(serviceCase);
    expect(serviceCase.value).toBe("CASE-RESIZE");
    expect(change).not.toHaveBeenCalled();
  });
});

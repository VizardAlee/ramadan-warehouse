// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PosPage from "@/app/(protected)/pos/page";
import { PriceLevelControl } from "@/features/pos/price-level-control";
import { calculatePosCart, changePosPriceTier, reconcileHeldCart } from "@/features/pos/calculations";
import type { HeldPosSale } from "@/features/pos/types";
const state = vi.hoisted(() => ({ held: [] as HeldPosSale[], call: vi.fn(), online: true, auth: { user: { uid: "demo-user" }, profile: { uid: "demo-user", organizationId: "demo-org", status: "active", roleId: "system_administrator", roleIds: ["system_administrator"], branchIds: ["demo-store"], warehouseIds: [] }, accessProfile: { branchIds: ["demo-store"] }, operatingContext: { type: "branch", id: "demo-store" } } }));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => state.auth }));
vi.mock("@/features/administration/api", () => ({ callAdministration: state.call }));
vi.mock("@/features/administration/use-organization-collection", () => ({ useOrganizationCollection: () => ({ data: [{ id: "demo-store", name: "Demo Store", status: "active" }], loading: false }) }));
vi.mock("@/lib/connectivity", () => ({ useConnectivity: () => ({ online: state.online }) }));
vi.mock("@/features/pos/collection-queue", () => ({ CollectionQueue: () => null }));
vi.mock("@/features/pos/service-line-options", () => ({ ServiceLineOptions: () => null }));
vi.mock("@/components/ui/use-dialog-focus", () => ({ useDialogFocus: () => ({ current: null }) }));
vi.mock("@/features/pos/offline-store", () => ({ listQueuedSales: async () => [], listHeldSales: async () => state.held, saveCachedWorkspace: async () => {}, readCachedWorkspace: async () => null, saveHeldSale: async (held: HeldPosSale) => { state.held.push(held); }, removeHeldSale: async (id: string) => { state.held = state.held.filter(held => held.id !== id); }, removeQueuedSale: async () => {}, queueOfflineSale: async () => {}, updateQueuedSale: async () => {} }));
const product = { id: "demo-product", name: "Demo battery", sku: "DEMO-BAT", unitOfMeasure: "unit", trackingType: "quantity" as const, unitPriceMinor: 85_000_000, basePriceMinor: 85_000_000, wholesalePriceMinor: 75_000_000, centralPriceVersion: 2, priceVersion: 2, priceSource: "central" as const, availableQuantity: 20, vatRateBasisPoints: 0 };
const workspace = { branch: { id: "demo-store", name: "Demo Store", code: "DEMO" }, location: { id: "demo-location", name: "Demo Stock" }, products: [product], customers: [{ id: "demo-customer", name: "Demo Buyer", customerNumber: "CUS-DEMO", creditStatus: "pending", availableCreditMinor: 0, outstandingBalanceMinor: 0 }], bankAccounts: [], salesCredits: [], pendingOrders: [], openShift: { id: "demo-shift", deviceId: "demo-device", status: "open" }, refreshedAt: new Date().toISOString() };
beforeEach(() => { HTMLElement.prototype.scrollIntoView = vi.fn(); state.held = []; state.online = true; localStorage.clear(); sessionStorage.clear(); state.call.mockImplementation(name => Promise.resolve(name === "getPosWorkspace" ? workspace : { orderId: "demo-order", orderNumber: "ORD-DEMO", created: true })); });
afterEach(() => { cleanup(); sessionStorage.clear(); vi.clearAllMocks(); });
async function basket() { render(<PosPage />); const add = await screen.findByRole("button", { name: "Add", exact: true }); await waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(false)); fireEvent.click(add); await screen.findByLabelText("Price level for Demo battery"); }
describe("POS client complaint regressions", () => {
  const remoteCustomer = { ...workspace.customers[0]!, id: "past-workspace-cap", customerNumber: "CUS-1005", name: "Alhaji Aliyu Ventures", pricingTier: "wholesale" };
  async function selectRemoteCustomer() {
    state.call.mockImplementation((name, input) => Promise.resolve(name === "getPosWorkspace" ? input.customerSearch ? { customers: [remoteCustomer], nextCursor: null, scanned: 1, complete: true, scanLimited: false } : { ...workspace, customers: input.customerId === remoteCustomer.id ? [...workspace.customers, remoteCustomer] : workspace.customers } : { orderId: "demo-order", orderNumber: "ORD-DEMO", created: true }));
    fireEvent.change(screen.getByLabelText("Search customer name"), { target: { value: "liyu" } });
    await screen.findByRole("option", { name: "Alhaji Aliyu Ventures · CUS-1005" });
    expect((screen.getByLabelText("Customer", { exact: true }) as HTMLSelectElement).value).toBe("");
    expect((screen.getByLabelText("Quantity for Demo battery") as HTMLInputElement).value).toBe("2");
    expect((screen.getByLabelText("Discount (₦)") as HTMLInputElement).value).toBe("50000");
    expect(state.call.mock.calls.some(call => call[0] === "createPosSaleOrder")).toBe(false);
    fireEvent.change(screen.getByLabelText("Customer", { exact: true }), { target: { value: remoteCustomer.id } });
  }
  it("searches without changing the basket and selects the matching ID using existing wholesale pricing", async () => {
    await basket();
    fireEvent.change(screen.getByLabelText("Quantity for Demo battery"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Discount (₦)"), { target: { value: "50000" } });
    fireEvent.change(screen.getByLabelText("Discount reason"), { target: { value: "Agreed search test discount" } });
    await selectRemoteCustomer();
    fireEvent.click(screen.getByRole("button", { name: "Refresh stock & prices" }));
    await waitFor(() => expect(state.call.mock.calls.some(call => call[0] === "getPosWorkspace" && call[1].customerId === remoteCustomer.id)).toBe(true));
    await waitFor(() => expect((screen.getByRole("button", { name: /^Receive order/ }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: /^Receive order/ }));
    await screen.findByText(/Order ORD-DEMO received/);
    const orders = state.call.mock.calls.filter(call => call[0] === "createPosSaleOrder");
    expect(orders).toHaveLength(1);
    expect(orders[0]![1]).toMatchObject({ customerId: remoteCustomer.id, discountAmountMinor: 5_000_000, discountReason: "Agreed search test discount", lines: [{ quantity: 2, priceTier: "wholesale", unitPriceMinor: 75_000_000 }], payments: [{ method: "cash", amountMinor: 145_000_000 }] });
  });
  it("restores a held basket's selected customer beyond the loaded cap after a fresh page", async () => {
    await basket();
    fireEvent.change(screen.getByLabelText("Quantity for Demo battery"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Discount (₦)"), { target: { value: "50000" } });
    fireEvent.change(screen.getByLabelText("Discount reason"), { target: { value: "Held search discount" } });
    await selectRemoteCustomer();
    fireEvent.click(screen.getByRole("button", { name: "Hold sale & start new" }));
    await waitFor(() => expect(state.held).toHaveLength(1));
    await screen.findByText("Sale held on this device. A new transaction is ready.");
    cleanup(); render(<PosPage />);
    const resume = await screen.findByRole("button", { name: "Resume sale" });
    await waitFor(() => expect((resume as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(resume);
    await waitFor(() => expect((screen.getByLabelText("Customer", { exact: true }) as HTMLSelectElement).value).toBe(remoteCustomer.id));
    expect(state.call.mock.calls.some(call => call[0] === "getPosWorkspace" && call[1].customerSearch?.customerId === remoteCustomer.id)).toBe(true);
    expect((screen.getByLabelText("Quantity for Demo battery") as HTMLInputElement).value).toBe("2");
    expect((screen.getByLabelText("Discount reason") as HTMLInputElement).value).toBe("Held search discount");
    expect(state.call.mock.calls.some(call => call[0] === "createPosSaleOrder")).toBe(false);
  });
  it("retries an interrupted online order with the same payload/key after reload instead of receiving another", async () => {
    await basket(); state.call.mockImplementation(name => name === "getPosWorkspace" ? Promise.resolve(workspace) : Promise.reject(new Error("Connection interrupted")));
    fireEvent.click(screen.getByRole("button", {name:/^Receive order/}));
    await screen.findByRole("button", {name:"Retry same order"});
    const original = state.call.mock.calls.find(c=>c[0]==="createPosSaleOrder")![1];
    cleanup();
    state.call.mockImplementation(name=>Promise.resolve(name==="getPosWorkspace"?workspace:{orderId:"demo-order",orderNumber:"ORD-DEMO",created:false}));
    render(<PosPage />);
    const retry = await screen.findByRole("button", {name:"Retry same order"});
    await waitFor(()=>expect((retry as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(retry); await screen.findByText(/Order ORD-DEMO received/);
    expect(state.call.mock.calls.filter(c=>c[0]==="createPosSaleOrder").at(-1)![1]).toEqual(JSON.parse(JSON.stringify(original)));
    expect(sessionStorage.getItem("abr-pending-pos-order:demo-org:demo-user")).toBeNull();
  });

  it.each([["Part payment", "500000", 50_000_000, 30_000_000], ["Pay later", "0", 0, 80_000_000], ["Pay in full", "0", 80_000_000, 0]] as const)("explains the missing discount reason and receives %s once the requirement is met", async (mode, paid, paidMinor, creditMinor) => {
    await basket();
    fireEvent.change(screen.getByLabelText("Discount (₦)"), { target: { value: "50000" } });
    fireEvent.change(screen.getByLabelText("Customer", { exact: true }), { target: { value: "demo-customer" } });
    fireEvent.click(screen.getByRole("button", { name: mode, exact: true }));
    if (mode === "Part payment") fireEvent.change(screen.getByLabelText("Amount paid now (₦)"), { target: { value: paid } });
    if (mode !== "Pay in full") fireEvent.change(screen.getByLabelText(/Payment due date/), { target: { value: "2026-10-16" } });
    const receive = screen.getByRole("button", { name: /^Receive order/ }) as HTMLButtonElement;
    expect(receive.disabled).toBe(true);
    expect(screen.getByText(/Receive order is unavailable: enter the required Discount reason/)).toBeTruthy();
    expect(state.call.mock.calls.some(c => c[0] === "createPosSaleOrder")).toBe(false);
    fireEvent.change(screen.getByLabelText("Discount reason"), { target: { value: "Agreed demo discount" } });
    expect(receive.disabled).toBe(false);
    fireEvent.click(receive);
    await screen.findByText(/Order ORD-DEMO received/);
    const orders = state.call.mock.calls.filter(c => c[0] === "createPosSaleOrder");
    expect(orders).toHaveLength(1);
    expect(orders[0]![1]).toMatchObject({ calculationVersion: 2, discountAmountMinor: 5_000_000, discountReason: "Agreed demo discount", creditAmountMinor: creditMinor, customerId: "demo-customer", lines: [{ productId: product.id, quantity: 1, priceTier: "retail" }] });
    expect(orders[0]![1].payments.reduce((n: number, p: {amountMinor: number}) => n + p.amountMinor, 0)).toBe(paidMinor);
    if (creditMinor) expect(orders[0]![1].creditDueDate).toBe("2026-10-16");
    expect(state.call.mock.calls.some(c => c[0] === "confirmPosSaleOrder")).toBe(false);
  });
  it("keeps ordinary customer credit authorization and online boundaries", async () => {
    state.auth.profile.roleId = "branch_manager"; state.auth.profile.roleIds = ["branch_manager"];
    try { await basket(); fireEvent.change(screen.getByLabelText("Customer", {exact:true}), {target:{value:"demo-customer"}}); fireEvent.click(screen.getByRole("button",{name:"Pay later",exact:true})); expect((screen.getByRole("button",{name:/^Receive order/}) as HTMLButtonElement).disabled).toBe(true); expect(screen.getByText(/needs administrator-approved credit/)).toBeTruthy(); }
    finally { state.auth.profile.roleId="system_administrator"; state.auth.profile.roleIds=["system_administrator"]; }
  });
  it("explains absent wholesale configuration without inventing a price", () => {
    render(<PriceLevelControl line={{ product: { ...product, wholesalePriceMinor: null }, quantity: 1 }} onChange={vi.fn()} />);
    expect((screen.getByRole("option", {name:"Wholesale"}) as HTMLOptionElement).disabled).toBe(true);
    expect(screen.getByText(/Wholesale is unavailable: no current wholesale price is configured/)).toBeTruthy();
  });
  it("switches configured wholesale and back to retail, replacing an explicit one-sale override and preserving held tier", () => {
    const line = { product, quantity: 2, sellingPriceMinor: 81_000_000, priceOverrideReason: "Demo negotiated price" };
    const changed = changePosPriceTier(line, product, "wholesale");
    expect(changed).toMatchObject({ priceTier: "wholesale", product: { unitPriceMinor: 75_000_000, priceVersion: 2 }, quantity: 2 });
    expect(changed.sellingPriceMinor).toBeUndefined();
    expect(calculatePosCart([changed], 5_000_000)).toMatchObject({ netAmountMinor: 145_000_000, grossAmountMinor: 145_000_000 });
    const restored = reconcileHeldCart([{productId:product.id,quantity:2,priceTier:changed.priceTier}], [product]);
    expect(restored.lines[0]).toMatchObject({priceTier:"wholesale",product:{unitPriceMinor:75_000_000}});
    expect(changePosPriceTier(changed, product, "retail").product.unitPriceMinor).toBe(85_000_000);
    expect(line.sellingPriceMinor).toBe(81_000_000);
  });
  it("shows a configured wholesale selection and updates the actual page total", async () => {
    await basket(); fireEvent.change(screen.getByLabelText("Price level for Demo battery"), {target:{value:"wholesale"}});
    expect((screen.getByLabelText("Price level for Demo battery") as HTMLSelectElement).value).toBe("wholesale");
    fireEvent.change(screen.getByLabelText("Discount (₦)"),{target:{value:"50000"}});
    fireEvent.change(screen.getByLabelText("Discount reason"),{target:{value:"Demo dealer discount"}});
    fireEvent.click(screen.getByRole("button",{name:/^Receive order/}));
    await screen.findByText(/Order ORD-DEMO received/);
    expect(state.call.mock.calls.find(c=>c[0]==="createPosSaleOrder")![1]).toMatchObject({lines:[{priceTier:"wholesale",unitPriceMinor:75_000_000,priceVersion:2}],payments:[{method:"cash",amountMinor:70_000_000}]});
  });
});


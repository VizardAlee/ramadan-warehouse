// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PosPage from "@/app/(protected)/pos/page";
import { FinancialPrivacyProvider, privacyStorageKey } from "@/features/finance/financial-privacy";
import { FinancialPrivacyToggle } from "@/features/finance/financial-privacy-toggle";
const state = vi.hoisted(() => ({ call: vi.fn(), online: true, auth: { user: { uid: "demo-user" }, profile: { uid: "demo-user", organizationId: "demo-org", status: "active", roleId: "system_administrator", roleIds: ["system_administrator"], branchIds: ["demo-store"], warehouseIds: [] }, accessProfile: { branchIds: ["demo-store"] }, operatingContext: { type: "branch", id: "demo-store" } } }));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => state.auth }));
vi.mock("@/features/administration/api", () => ({ callAdministration: state.call }));
vi.mock("@/features/administration/use-organization-collection", () => ({ useOrganizationCollection: () => ({ data: [{ id: "demo-store", name: "Demo Store", status: "active" }], loading: false }) }));
vi.mock("@/lib/connectivity", () => ({ useConnectivity: () => ({ online: state.online }) }));
vi.mock("@/features/pos/collection-queue", () => ({ CollectionQueue: () => null }));
vi.mock("@/features/pos/service-line-options", () => ({ ServiceLineOptions: () => null }));
vi.mock("@/components/ui/use-dialog-focus", () => ({ useDialogFocus: () => ({ current: null }) }));
vi.mock("@/features/pos/offline-store", () => ({ listQueuedSales: async () => [], listHeldSales: async () => [], saveCachedWorkspace: async () => {}, readCachedWorkspace: async () => null, saveHeldSale: vi.fn(), removeHeldSale: async () => {}, removeQueuedSale: async () => {}, queueOfflineSale: async () => {}, updateQueuedSale: async () => {} }));
const workspace = { branch: { id: "demo-store", name: "Demo Store", code: "DEMO" }, location: { id: "demo-location", name: "Demo Stock" }, products: [], customers: [], bankAccounts: [], salesCredits: [], pendingOrders: [], openShift: null, refreshedAt: new Date().toISOString() };
beforeEach(() => { HTMLElement.prototype.scrollIntoView = vi.fn(); localStorage.clear(); sessionStorage.clear(); state.call.mockImplementation(name => Promise.resolve(name === "getPosWorkspace" ? workspace : {})); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe("actual POS opening cash privacy", () => {
 it.each(["local", "input"])("blocks default zero opening cash until %s review, preserving the original request", async review => {
  render(<FinancialPrivacyProvider organizationId="demo-org" uid="demo-user"><FinancialPrivacyToggle /><PosPage /></FinancialPrivacyProvider>);
  const button = await screen.findByRole("button", { name: "Open shift and start selling" });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(button); expect(state.call.mock.calls.filter(c => c[0] === "openPosShift")).toHaveLength(0);
  if (review === "local") fireEvent.click(button.closest("section")!.querySelector<HTMLButtonElement>(".financial-review-control")!);
  else fireEvent.click(screen.getByRole("button", {name: "Review / enter actual amount"}));
  expect((screen.getByLabelText(/^Opening cash \(₦\)/) as HTMLInputElement).value).toBe("0.00");
  fireEvent.click(button);
  await waitFor(() => expect(state.call.mock.calls.filter(c => c[0] === "openPosShift")).toHaveLength(1));
  expect(state.call.mock.calls.find(c => c[0] === "openPosShift")![1]).toMatchObject({ branchId: "demo-store", openingCashMinor: 0, deviceId: expect.any(String), idempotencyKey: expect.any(String) });
  expect(screen.getByRole("button", {name: "Hide financial values"}).getAttribute("aria-pressed")).toBe("true");
  expect(localStorage.getItem(privacyStorageKey("demo-org", "demo-user")) ?? "").not.toContain('"hidden":false');
 });
});

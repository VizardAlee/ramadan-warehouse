// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBranchPriceColumns } from "@/features/products/branch-price-columns";
const state = vi.hoisted(() => ({ context: { type: "branch", id: "a" } as { type: "branch"; id: string } | null, canRead: true, error: null as string | null }));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => ({ profile: {}, operatingContext: state.context }) }));
vi.mock("@/features/auth/use-operating-context-options", () => ({ useOperatingContextOptions: () => ({ options: [{ type: "branch", id: "a", name: "Branch A" }, { type: "branch", id: "b", name: "Branch B" }] }) }));
vi.mock("@/lib/permissions/roles", () => ({ hasPermission: () => state.canRead }));
vi.mock("@/features/finance/financial-privacy", () => ({ FinancialValue: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/features/administration/use-organization-collection", () => ({ useOrganizationCollection: () => ({ loading: false, error: state.error, data: [{ id: "a-p", productId: "p", branchId: "a", active: true, version: 1, sellingPriceMinor: 15000, wholesalePriceMinor: 25000, belowBaseApproved: true, belowWholesaleApproved: true, basePriceVersion: 0 }] }) }));
function Price({ tier = "retail", centralStatus }: { tier?: "retail" | "wholesale"; centralStatus?: "error" }) { const value = useBranchPriceColumns(); return <>{value("p", null, tier, centralStatus)}</>; }
beforeEach(() => { state.context = { type: "branch", id: "a" }; state.canRead = true; state.error = null; });
afterEach(cleanup);
describe("effective branch price columns", () => {
  it("shows branch-only retail and wholesale amounts without a central record", () => {
    const view = render(<Price />); expect(screen.getByText(/150/)).toBeTruthy(); expect(screen.getByText("Branch override")).toBeTruthy();
    view.rerender(<Price tier="wholesale" />); expect(screen.getByText(/250/)).toBeTruthy();
  });
  it("keeps All prices attributed to their branch and never invents a missing zero price", () => {
    state.context = null; render(<Price />);
    expect(screen.getByText("Branch A")).toBeTruthy(); expect(screen.getByText("Branch B")).toBeTruthy(); expect(screen.getByText("Not configured")).toBeTruthy();
  });
  it("does not show another branch's override in the selected branch", () => {
    state.context = { type: "branch", id: "b" }; render(<Price />); expect(screen.getByText("Not configured")).toBeTruthy(); expect(screen.queryByText(/150/)).toBeNull();
  });
  it("distinguishes unreadable prices from absent configuration", () => {
    state.error = "denied"; const view = render(<Price />); expect(screen.getByText("Unable to load branch prices")).toBeTruthy();
    state.error = null; view.rerender(<Price centralStatus="error" />); expect(screen.getByText("Unable to verify central fallback")).toBeTruthy();
  });
  it("retains existing read permissions", () => { state.canRead = false; render(<Price />); expect(screen.getByText("Restricted")).toBeTruthy(); });
});

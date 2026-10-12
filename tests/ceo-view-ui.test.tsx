// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CeoView } from "@/features/dashboard/ceo-view";
import type { CeoDashboard } from "../functions/src/dashboard/ceo-model";
const mocks = vi.hoisted(() => ({ call: vi.fn(), context: vi.fn(), profile: { roleId: "system_administrator", status: "active", branchIds: [], warehouseIds: [], displayName: "Owner" } }));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => ({ profile: mocks.profile, setOperatingContext: mocks.context }) }));
vi.mock("@/features/administration/api", () => ({ callAdministration: mocks.call }));
const data: CeoDashboard = { asOf: "2026-10-11T10:00:00Z", fromDate: "2026-10-01", toDate: "2026-10-10", branchId: null,
  metrics: [{ id: "invoiced", label: "Invoiced sales", value: 50000, money: true, basis: "period", detail: "Gross before refunds", href: "/reports", state: "ready" }, { id: "issues", label: "Transfer issues", value: null, money: false, basis: "current", detail: "Current issues", href: "/transfers", state: "unavailable" }],
  trend: [{ fromDate: "2026-10-01", toDate: "2026-10-10", invoicedMinor: 50000, checkoutReceiptsMinor: 10000 }],
  comparison: { fromDate: "2026-09-21", toDate: "2026-09-30", invoicedMinor: 0 }, branches: [{ id: "branch-a", name: "Kano", invoicedMinor: 50000 }], nextBranchCursor: null, branchError: false, billingConfigured: false };
beforeEach(() => { mocks.profile.roleId = "system_administrator"; mocks.call.mockResolvedValue(data); window.history.replaceState(null, "", "/dashboard/ceo?fromDate=2026-10-01&toDate=2026-10-10"); window.sessionStorage.clear(); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe("CEO overview interaction", () => {
  it("renders real figures, honest failures, configuration and zero-baseline comparison", async () => {
    render(<CeoView />);
    await screen.findByText("Transfer issues");
    expect(screen.getByText("Unavailable")).toBeTruthy();
    expect(screen.getByText(/No prior invoiced value/)).toBeTruthy();
    expect(screen.getByText(/Mixed billing needs its account setup/)).toBeTruthy();
    expect(screen.getByText("Gross before refunds")).toBeTruthy();
    expect(mocks.call).toHaveBeenCalledWith("getDashboardWorkspace", expect.objectContaining({ section: "ceo", fromDate: "2026-10-01", toDate: "2026-10-10" }));
  });
  it("provides keyboard links and text figures, toggles series and preserves chart interval", async () => {
    render(<CeoView />); await screen.findByText("Transfer issues");
    const bar = screen.getByRole("link", { name: /2026-10-01 to 2026-10-10/ });
    expect(bar.getAttribute("href")).toContain("fromDate=2026-10-01");
    bar.focus(); expect(document.activeElement).toBe(bar);
    fireEvent.click(screen.getByRole("button", { name: "Checkout receipts" }));
    expect(screen.getByRole("button", { name: "Checkout receipts" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("View chart figures & open details")).toBeTruthy();
  });
  it("keeps draft filters unchanged until apply and supports cancel and branch drilldown", async () => {
    render(<CeoView />); await screen.findByRole("heading", { name: "Kano" });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-03" } });
    expect(mocks.call).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel changes" }));
    expect((screen.getByLabelText("From") as HTMLInputElement).value).toBe("2026-10-01");
    const link = screen.getByRole("link", { name: "Open sales" });
    link.addEventListener("click", event => event.preventDefault(), { once: true }); fireEvent.click(link);
    expect(mocks.context).toHaveBeenCalledWith({ type: "branch", id: "branch-a" });
  });
  it("keeps directory and switchback usable when data fails", async () => {
    mocks.call.mockRejectedValue(new Error("offline")); render(<CeoView />);
    await screen.findByRole("alert");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "provider funds" } });
    expect(screen.getByRole("link", { name: /Provider funds register/ }).getAttribute("href")).toBe("/expenses#provider-funds");
    expect(screen.getByRole("link", { name: "Usual dashboard" }).getAttribute("href")).toBe("/dashboard");
  });
  it("does not fetch or enumerate modules for branch-scoped staff", async () => {
    mocks.profile.roleId = "branch_manager"; render(<CeoView />);
    await waitFor(() => expect(screen.getByText(/requires existing organization-wide access/)).toBeTruthy());
    expect(mocks.call).not.toHaveBeenCalled();
    expect(screen.queryByRole("searchbox")).toBeNull();
  });
  it("keeps loading honest and does not paint a late response from the previous filter", async () => {
    let resolveOld!: (data: CeoDashboard) => void, resolveNew!: (data: CeoDashboard) => void;
    mocks.call.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { resolveNew = resolve; }));
    render(<CeoView />); await waitFor(() => expect(mocks.call).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Refreshing recorded data…")).toBeTruthy();
    expect(screen.queryByText("Transfer issues")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "7 days" }));
    await waitFor(() => expect(mocks.call).toHaveBeenCalledTimes(2));
    resolveNew({ ...data, metrics: [{ ...data.metrics[0]!, label: "Latest interval sales" }] });
    await screen.findByText("Latest interval sales");
    resolveOld({ ...data, metrics: [{ ...data.metrics[0]!, label: "Stale interval sales" }] });
    await waitFor(() => expect(screen.queryByText("Stale interval sales")).toBeNull());
  });
  it("shows empty charts and branch metadata without inventing activity", async () => {
    mocks.call.mockResolvedValue({ ...data, metrics: [], trend: [{ ...data.trend![0]!, invoicedMinor: 0, checkoutReceiptsMinor: 0 }], branches: [] });
    render(<CeoView />); await screen.findByText("No branches recorded.");
    expect(screen.getByText("No recorded invoices or checkout receipts in this period.")).toBeTruthy();
    expect(screen.queryByLabelText(/Invoiced sales chart/)).toBeNull();
  });
  it("restores applied URL filters on repeated navigation", async () => {
    const view = render(<CeoView />); await screen.findByText("Transfer issues");
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-02" } });
    fireEvent.submit(screen.getByRole("form", { name: "Overview filters" }));
    await waitFor(() => expect(window.location.search).toContain("fromDate=2026-10-02"));
    view.unmount(); render(<CeoView />);
    await waitFor(() => expect((screen.getByLabelText("From") as HTMLInputElement).value).toBe("2026-10-02"));
  });
  it("immediately removes old financial data after a still-eligible authorization refresh", async () => {
    mocks.call.mockResolvedValueOnce({ ...data, metrics: [{ ...data.metrics[0]!, id: "providerFunds", label: "Restricted provider balance" }] });
    let resolveReduced!: (value: CeoDashboard) => void;
    mocks.call.mockImplementationOnce(() => new Promise(resolve => { resolveReduced = resolve; }));
    const view = render(<CeoView />); await screen.findByText("Restricted provider balance");
    mocks.profile.roleId = "operations_administrator"; view.rerender(<CeoView />);
    expect(screen.queryByText("Restricted provider balance")).toBeNull();
    await waitFor(() => expect(mocks.call).toHaveBeenCalledTimes(2));
    resolveReduced({ ...data, metrics: [{ ...data.metrics[0]!, label: "Permitted operations summary" }] });
    await screen.findByText("Permitted operations summary");
    expect(screen.queryByText("Restricted provider balance")).toBeNull();
  });
});

describe("executive comparison presentation", () => {
  it("shows two distinct real series and preserves interval drilldowns without adding their values", async () => {
    render(<CeoView />); await screen.findByText("Transfer issues");
    expect(screen.getByRole("button", { name: "Compare", exact: true }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("link", { name: /2026-10-01 to 2026-10-10: invoiced.*checkout receipts/ }).getAttribute("href")).toContain("toDate=2026-10-10");
    expect(screen.getByRole("link", { name: /Highest invoiced interval/ }).getAttribute("href")).toContain("fromDate=2026-10-01");
    expect(screen.getByRole("navigation", { name: "CEO sections" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Current position", exact: true }).getAttribute("href")).toBe("#ceo-position");
  });
});

// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { InvoiceHistory } from "@/features/invoices/invoice-history";
import { AppShell } from "@/components/layout/app-shell";
import { CeoView } from "@/features/dashboard/ceo-view";
import type { UserProfile } from "@/types/domain";
const state = vi.hoisted(() => ({ call: vi.fn(), role: "branch_manager", ids: ["own"], path: "/invoices" }));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => ({ user: { uid: "staff" }, profile: { uid: "staff", organizationId: "org", status: "active", roleId: state.role, branchIds: state.ids, warehouseIds: [], displayName: "Authorized staff" } as UserProfile, operatingContext: null, setOperatingContext: vi.fn(), logout: vi.fn(), refreshAuthorization: vi.fn(), loading: false }) }));
vi.mock("@/features/administration/api", () => ({ callAdministration: state.call }));
vi.mock("next/navigation", () => ({ usePathname: () => state.path, useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("next/image", () => ({ default: (props: Record<string, unknown>) => { const rest = Object.fromEntries(Object.entries(props).filter(([key]) => key !== "priority")); return createElement("img", { ...rest, alt: String(props.alt) }); } }));
vi.mock("@/features/guidance/action-guidance", async importOriginal => ({ ...await importOriginal<typeof import("@/features/guidance/action-guidance")>(), ActionGuidanceProvider: ({ children }: { children: ReactNode }) => children, WorkspacePrerequisites: () => null }));
vi.mock("@/features/auth/use-operating-context-options", () => ({ useOperatingContextOptions: () => ({ options: [{ value: "branch:own", typeLabel: "Store", name: "A long but legitimate store display name" }, { value: "branch:second", typeLabel: "Store", name: "Second assigned store" }], activeValue: "branch:own", activeOption: { typeLabel: "Store", name: "Own store" }, canSelectAll: true, selectValue: vi.fn() }) }));
vi.mock("@/features/pwa/pwa-controls", () => ({ PwaControls: () => null }));
vi.mock("@/features/pwa/pwa-install-banner", () => ({ PwaInstallBanner: () => null }));
vi.mock("@/features/notifications/notification-menu", () => ({ NotificationMenu: () => null }));
vi.mock("@/features/theme/theme-provider", () => ({ useTheme: () => ({ preference: "system", setPreference: vi.fn() }) }));
vi.mock("@/lib/connectivity", () => ({ useConnectivity: () => ({ online: true }) }));
const row = { id: "sale-a", saleNumber: "SAL-ORIGINAL", receiptNumber: "REC-ORIGINAL", branchId: "own", branchName: "Kano store", customerName: "Amina Solar Installations and Trading", customerNumber: "CUS-001", paymentStatus: "partially_paid", recordedAt: "2026-10-10T12:00:00Z", grossAmountMinor: 107500 };
const saleDocument = { official: true, organization: { legalName: "AB Ramadan Ltd.", tradingName: null, phoneNumbers: [] }, branch: { id: "own", name: "Kano store", code: "KN" }, sale: { ...row, invoiceNumber: row.saleNumber, netAmountMinor: 100000, subtotalAmountMinor: 100000, discountAmountMinor: 0, vatAmountMinor: 7500, amountPaidMinor: 50000, creditAmountMinor: 57500, currency: "NGN", postedAt: row.recordedAt }, items: [{ id: "item", productName: "Original solar equipment", sku: "SKU-ORIGINAL", quantity: 1, unitOfMeasure: "unit", unitPriceMinor: 100000, subtotalAmountMinor: 100000, discountAmountMinor: 0, vatRateBasisPoints: 750, netAmountMinor: 100000, vatAmountMinor: 7500, grossAmountMinor: 107500 }], payments: [] };
function fixture(name: string) {
  if (!process.env.INVOICE_HISTORY_FIXTURE_DIR) return;
  mkdirSync(process.env.INVOICE_HISTORY_FIXTURE_DIR, { recursive: true });
  const body = document.body.cloneNode(true) as HTMLBodyElement;
  const originals = document.body.querySelectorAll("input,select,textarea");
  body.querySelectorAll("input,select,textarea").forEach((element, index) => {
    const original = originals[index] as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    if (element instanceof HTMLSelectElement) [...element.options].forEach(option => { option.selected = option.value === original.value; if (option.selected) option.setAttribute("selected", ""); else option.removeAttribute("selected"); });
    else element.setAttribute("value", original.value);
  });
  writeFileSync(`${process.env.INVOICE_HISTORY_FIXTURE_DIR}/${name}.html`, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="app.css"></head>${body.outerHTML}</html>`);
}
beforeEach(() => {
  state.role = "branch_manager"; state.ids = ["own"]; state.path = "/invoices";
  state.call.mockReset();
  state.call.mockImplementation(async (name: string) => name === "getSaleDocument" ? saleDocument : { rows: [row], nextCursor: null });
  window.history.replaceState(null, "", "/invoices");
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("Invoice History", () => {
  it("loads complete history, searches receipt/customer, filters saved status and refreshes date/store scope", async () => {
    state.ids = ["own", "second"];
    state.call.mockImplementation(async (_name: string, input: Record<string, unknown>) => ({ rows: [{ ...row, branchId: input.branchId }], nextCursor: null }));
    render(<InvoiceHistory />);
    expect(screen.getByRole("option", { name: "Choose an assigned store" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Store"), { target: { value: "own" } });
    await screen.findByText("SAL-ORIGINAL");
    expect(state.call).toHaveBeenCalledWith("generateSalesReport", expect.objectContaining({ branchId: "own", includeSummary: false }));
    expect(screen.queryByRole("option", { name: "All permitted stores" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Search invoices"), { target: { value: "rec-original" } }); expect(screen.getByText("SAL-ORIGINAL")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search invoices"), { target: { value: "unmatched" } }); expect(screen.getByText(/No invoices match/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search invoices"), { target: { value: "amina" } });
    fireEvent.change(screen.getByLabelText("Recorded payment status"), { target: { value: "partially_paid" } }); expect(screen.getByText("SAL-ORIGINAL")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Store"), { target: { value: "second" } }); await screen.findByText("SAL-ORIGINAL");
    expect(state.call).toHaveBeenLastCalledWith("generateSalesReport", expect.objectContaining({ branchId: "second" }));
    fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2026-09-01" } });
    await waitFor(() => expect(state.call).toHaveBeenLastCalledWith("generateSalesReport", expect.objectContaining({ fromDate: "2026-09-01", branchId: "second" })));
  });
  it("opens the same official document and preserves real print/save-PDF controls; exposes navigation on desktop and More", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    render(<AppShell><InvoiceHistory /></AppShell>); await screen.findByText("SAL-ORIGINAL");
    expect(screen.getByRole("link", { name: "Invoice History" }).getAttribute("href")).toBe("/invoices"); fixture("invoice-history");
    fireEvent.click(screen.getByRole("button", { name: /More/ }));
    expect(screen.getAllByRole("link", { name: "Invoice History" }).length).toBeGreaterThan(1); fixture("invoice-navigation");
    fireEvent.click(screen.getAllByRole("button", { name: "Close more destinations" }).at(-1)!);
    fireEvent.click(screen.getByRole("button", { name: "View invoice" })); await screen.findByRole("dialog", { name: "Official sale invoice and receipt" });
    expect(state.call).toHaveBeenCalledWith("getSaleDocument", { saleId: "sale-a" }); fixture("invoice-dialog");
    fireEvent.click(screen.getByRole("button", { name: "Print or save PDF" })); expect(print).toHaveBeenCalledOnce();
    expect(state.call.mock.calls.every(([name, input]) => name === "getMyAccessContext" ? input?.action === "release_notes" : ["generateSalesReport", "getSaleDocument"].includes(name))).toBe(true);
  });
  it("downloads matching saved rows safely without creating an invoice or recording payment", async () => {
    let saved: Blob | undefined;
    const BaseURL = URL;
    vi.stubGlobal("URL", class extends BaseURL { static createObjectURL(value: Blob) { saved = value; return "blob:invoice-history"; } static revokeObjectURL() {} });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    state.call.mockResolvedValue({ rows: [{ ...row, customerName: "=HYPERLINK(unsafe)" }], nextCursor: null });
    render(<InvoiceHistory />); await screen.findByText("SAL-ORIGINAL");
    fireEvent.click(screen.getByRole("button", { name: "Download history CSV" })); expect(click).toHaveBeenCalledOnce();
    const reader = new FileReader(); const text = await new Promise<string>(resolve => { reader.onload = () => resolve(String(reader.result)); reader.readAsText(saved!); });
    expect(text).toContain("SAL-ORIGINAL"); expect(text).toContain("1075.00"); expect(text).toContain("'=HYPERLINK(unsafe)");
    expect(state.call.mock.calls.every(([name]) => name === "generateSalesReport")).toBe(true);
  });
  it("makes permissions, empty results, server errors and invalid dates explicit", async () => {
    state.role = "sales_cashier"; const view = render(<InvoiceHistory />);
    expect(screen.getByText(/requires your existing sales-report access/)).toBeTruthy(); expect(state.call).not.toHaveBeenCalled();
    state.role = "branch_manager"; state.call.mockRejectedValue(new Error("Existing store access was revoked")); view.rerender(<InvoiceHistory />);
    await screen.findByRole("alert"); expect(screen.queryByText(/No invoices match/)).toBeNull();
    state.call.mockResolvedValue({ rows: [], nextCursor: null }); fireEvent.click(screen.getByRole("button", { name: "Refresh history" })); await screen.findByText(/No invoices match/);
    fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2099-12-31" } }); expect(screen.getByRole("alert").textContent).toContain("valid start and end date");
  });
  it("hides previous store results immediately on changed authority and ignores late invoice responses", async () => {
    let resolve: (value: unknown) => void = () => {};
    state.call.mockImplementation(async (name: string) => name === "getSaleDocument" ? new Promise(r => { resolve = r; }) : { rows: [row], nextCursor: null });
    const view = render(<InvoiceHistory />); await screen.findByText("SAL-ORIGINAL"); fireEvent.click(screen.getByRole("button", { name: "View invoice" }));
    state.ids = ["second"]; state.call.mockImplementation(async () => ({ rows: [], nextCursor: null })); view.rerender(<InvoiceHistory />); expect(screen.queryByText("SAL-ORIGINAL")).toBeNull();
    resolve(saleDocument); await screen.findByText(/No invoices match/); expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("renders the real CEO workspace inside the responsive shell for viewport verification", async () => {
    state.role = "system_administrator"; state.path = "/dashboard/ceo";
    state.call.mockResolvedValue({ asOf: "2026-10-17T10:00:00Z", fromDate: "2026-10-01", toDate: "2026-10-17", branchId: null, metrics: [{ id: "invoiced", label: "Invoiced sales", value: 999999999, money: true, basis: "period", detail: "Recorded invoices in the selected dates", href: "/reports", state: "ready" }], trend: [{ fromDate: "2026-10-01", toDate: "2026-10-17", invoicedMinor: 999999999, checkoutReceiptsMinor: 100000 }], comparison: { fromDate: "2026-09-01", toDate: "2026-09-17", invoicedMinor: 100 }, branches: [{ id: "own", name: "Kano long store name", invoicedMinor: 999999999 }], nextBranchCursor: null, branchError: false, billingConfigured: true });
    render(<AppShell><CeoView /></AppShell>); await screen.findByRole("heading", { name: "Kano long store name" }); fixture("ceo-dashboard"); expect(screen.getByRole("link", { name: /Invoice History.*Find existing/ })).toBeTruthy();
  });
});

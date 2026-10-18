// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import SupplierProfilePage from "@/app/(protected)/suppliers/[supplier_id]/page";

const api = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useParams: () => ({ supplier_id: "supplier" }) }));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => ({ profile: { uid: "admin", status: "active", roleId: "system_administrator", authorizationVersion: 1 }, operatingContext: null }) }));
vi.mock("@/features/administration/api", () => ({ callAdministration: api }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("replaces account and activity evidence on repeated store switches without retaining credit or refund controls", async () => {
  const supplier = { id: "supplier", name: "Synthetic supplier", supplierNumber: "SUP-1", active: true, supplierType: "goods", advanceBalanceMinor: 10001, advanceBalancesByLocation: { "branch:a": 10001 } };
  api.mockImplementation(async (name: string, input: { view: string; branchId?: string }) => {
    if (name !== "getProcurementWorkspace") throw new Error(`Unexpected financial operation: ${name}`);
    const scope = input.branchId || "all", credit = scope === "b" ? null : 10001;
    switch (input.view) {
      case "supplier_profile": return { supplier, organizationWide: true, branches: [{ id: "a", name: "Store A" }, { id: "b", name: "Store B" }], warehouses: [], banks: [] };
      case "supplier_payables": return { totalOutstandingMinor: 0, unusedCreditMinor: credit, asOfDate: "2026-10-18", note: `Payables scope ${scope}`, aging: [], invoices: [], nextCursor: null };
      case "supplier_account": return { entries: [], nextCursor: null, openingPayableMinor: 0, closingPayableMinor: 0, openingAdvanceMinor: 0, closingAdvanceMinor: credit ?? 0, scopeNote: `Statement scope ${scope}` };
      case "supplier_activity": return { rows: [], nextCursor: null, providerFundsVisible: false, providerObligationMinor: null, note: `Activity scope ${scope}` };
      default: throw new Error(`Unexpected view: ${input.view}`);
    }
  });
  render(<SupplierProfilePage />);
  await screen.findByText("Statement scope all", { exact: false });
  for (const value of ["branch:a", "branch:b", "branch:a", "branch:b", ""]) {
    fireEvent.change(screen.getByRole("combobox", { name: "Supplier account store" }), { target: { value } });
    const scope = value.replace("branch:", "") || "all";
    await screen.findByText(`Statement scope ${scope}`, { exact: false });
    await screen.findByText(`Activity scope ${scope}`, { exact: false });
    await waitFor(() => {
      expect(screen.getAllByRole("heading", { name: "Supplier accounts & statements" })).toHaveLength(1);
      expect(screen.getAllByRole("region", { name: "Company and supplier activity" })).toHaveLength(1);
      const position = screen.getByRole("region", { name: "Supplier net position" });
      if (scope === "b") {
        expect(position.textContent).not.toContain("₦100.01");
        expect(position.textContent).toContain("Not established");
        expect(screen.queryByRole("button", { name: "Receive advance refund" })).toBeNull();
      } else {
        expect(position.textContent).toContain("₦100.01");
        expect(screen.getAllByRole("button", { name: "Receive advance refund" })).toHaveLength(1);
      }
    });
  }
  expect(api.mock.calls.every(([name]) => name === "getProcurementWorkspace")).toBe(true);
});

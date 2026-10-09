// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaxRuleWorkspace } from "@/features/accounting/tax-rule-workspace";
const api = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/features/administration/api", () => ({ callAdministration: api.call }));
afterEach(() => { cleanup(); sessionStorage.clear(); vi.resetAllMocks(); });
const rule = { id: "rule-1", taxType: "VAT", scopeKey: "standard", version: "v1", effectiveFrom: "2026-01-01", effectiveTo: "2026-12-31", status: "draft", rateBasisPoints: 750, basis: "taxable_supplies" };
const props = { rules: [rule], canManage: true, ownerKey: "org:user", onSaved: vi.fn() };
describe("tax rule review interface", () => {
  it("requires explicit source review and retries the original uncertain approval after remount", async () => {
    api.call.mockRejectedValueOnce(new Error("Connection interrupted")).mockResolvedValue({ status: "approved" });
    const view = render(<TaxRuleWorkspace {...props} />); fireEvent.click(screen.getByRole("button", { name: "View rule" }));
    await waitFor(() => expect((screen.getByLabelText("Review reason").closest("fieldset") as HTMLFieldSetElement).disabled).toBe(false));
    const approve = screen.getByRole("button", { name: "Approve reviewed rule" }) as HTMLButtonElement; expect(approve.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Review reason"), { target: { value: "Verified official statutory source" } }); expect(approve.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(approve);
    await screen.findByRole("button", { name: "Retry saved tax instructions" });
    const original = api.call.mock.calls[0]![1]; expect(original).toMatchObject({ action: "review", ruleId: "rule-1", decision: "approved", sourceVerified: true });
    view.unmount(); render(<TaxRuleWorkspace {...props} />);
    fireEvent.click(await screen.findByRole("button", { name: "Retry saved tax instructions" }));
    await screen.findByText(/Tax rule approved/); expect(api.call.mock.calls[1]![1]).toEqual(original);
    expect(sessionStorage.getItem("abr-pending-tax-rule:org:user")).toBeNull();
  });
  it("separates read-only calculation previews from configuration and financial posting", async () => {
    api.call.mockResolvedValue({ ruleId: "rule-1", taxMinor: 7500, baseMinor: 100000, ruleVersion: "v1", basis: "taxable_supplies", transactionDate: "2026-10-09" });
    render(<TaxRuleWorkspace {...props} canManage={false} rules={[{ ...rule, status: "approved", sourceVerified: true }]} />);
    expect(screen.queryByText("Propose a new tax rule version")).toBeNull(); fireEvent.click(screen.getByRole("button", { name: "View rule" }));
    await waitFor(() => expect((screen.getByLabelText("Transaction date").closest("fieldset") as HTMLFieldSetElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText("Transaction date"), { target: { value: "2026-10-09" } });
    fireEvent.change(screen.getByLabelText("Accountant-reviewed tax base (₦)"), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview tax calculation" }));
    await waitFor(() => expect(api.call).toHaveBeenCalledWith("taxRuleAdministration", { action: "preview", ruleId: "rule-1", transactionDate: "2026-10-09", baseMinor: 100000 }));
    expect(await screen.findByText(/Not posted/)).toBeTruthy(); expect(screen.queryByText("Approve reviewed rule")).toBeNull();
  });
});

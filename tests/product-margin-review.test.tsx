// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { marginReview, MarginReview } from "@/features/products/margin-review";
import { BranchPriceEditor } from "@/features/products/branch-price-editor";
import { FinancialPrivacyProvider } from "@/features/finance/financial-privacy";
const api = vi.hoisted(() => vi.fn());
vi.mock("@/features/administration/api", () => ({ callAdministration: api }));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => ({ profile: null }) }));
afterEach(() => { cleanup(); api.mockReset(); localStorage.clear(); });
it("uses gross margin, not markup, and includes the exact advisory boundary", () => {
  expect(marginReview(3000, 6000)).toBe("high");
  expect(marginReview(3001, 6000)).toBeNull();
  expect(marginReview(155000, 1600000)).toBe("high");
  expect(marginReview(1550000, 1600000)).toBeNull();
  expect(marginReview(6000, 3000)).toBeNull();
});
it("distinguishes missing and zero cost without inventing profit", () => {
  expect(marginReview(undefined, 6000)).toBe("missing");
  expect(marginReview(0, 6000)).toBe("zero");
  for (const price of [undefined, 0, -1, NaN, Infinity]) expect(marginReview(0, price)).toBeNull();
  expect(marginReview(-1, 6000)).toBeNull();
  render(<MarginReview cost={{ available: true }} retail={6000} />);
  expect(screen.getByRole("status").textContent).toContain("Estimated margin cannot be checked");
  expect(screen.getByRole("status").textContent).not.toContain("100.0%");
});
it("does not render unauthorized or unavailable cost diagnostics", () => {
  const view = render(<MarginReview retail={6000} />);
  expect(screen.queryByRole("status")).toBeNull();
  view.rerender(<MarginReview cost={{ available: false, unitCostNaira: 1 }} retail={6000} />);
  expect(screen.queryByRole("status")).toBeNull();
});
it("masks the complete financial warning in privacy mode", () => {
  const view = render(<FinancialPrivacyProvider organizationId="org" uid="user"><MarginReview cost={{ available: true, unitCostNaira: 700 }} retail={1500} /></FinancialPrivacyProvider>);
  expect(view.container.textContent).not.toContain("53.3");
  expect(view.container.textContent).not.toContain("catalogue default cost");
});
it("updates branch estimates for edits and inherited defaults without blocking save", async () => {
  api.mockResolvedValue({ saved: true });
  const onClose = vi.fn();
  render(<BranchPriceEditor branchId="civic" branchName="Civic Center" productId="p" productName="Panel" central={{ basePriceMinor: 600000, wholesalePriceMinor: 500000, version: 1 }} current={{}} marginCost={{ available: true, unitCostNaira: 3000 }} onClose={onClose} onSaved={() => {}} />);
  expect(screen.getByRole("status").textContent).toContain("Retail: estimated gross margin is 50.0%");
  fireEvent.change(screen.getByLabelText("Retail branch price (₦)"), { target: { value: "9000" } });
  expect(screen.getByRole("status").textContent).toContain("66.7%");
  fireEvent.change(screen.getByLabelText("Retail branch price (₦)"), { target: { value: "" } });
  expect(screen.getByRole("status").textContent).toContain("50.0%");
  fireEvent.click(screen.getByRole("button", { name: "Save branch prices" }));
  await waitFor(() => expect(api).toHaveBeenCalledWith("saveBranchSalesPrice", expect.objectContaining({ sellingPriceMinor: null, wholesalePriceMinor: null })));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
});
it("cancel closes without saving even when a warning is visible", () => {
  const onClose = vi.fn();
  render(<BranchPriceEditor branchId="civic" branchName="Civic Center" productId="p" productName="Panel" central={{ basePriceMinor: 600000, version: 1 }} current={{}} marginCost={{ available: true, unitCostNaira: 0 }} onClose={onClose} onSaved={() => {}} />);
  expect(screen.getByRole("status").textContent).toContain("catalogue cost is zero");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onClose).toHaveBeenCalledOnce(); expect(api).not.toHaveBeenCalled();
});

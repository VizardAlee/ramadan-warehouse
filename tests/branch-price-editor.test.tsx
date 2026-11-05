// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BranchPriceEditor } from "@/features/products/branch-price-editor";
const api = vi.hoisted(() => vi.fn());
vi.mock("@/features/administration/api", () => ({ callAdministration: api }));
afterEach(() => { cleanup(); api.mockReset(); });
const central = { basePriceMinor: 10000, wholesalePriceMinor: 8000, version: 8 };
function editor() { render(<BranchPriceEditor branchId="civic" branchName="Civic Center" productId="panel" productName="Panel" central={central}
  current={{ active: true, sellingPriceMinor: 12000, wholesalePriceMinor: 9000, version: 3 }} onClose={() => {}} onSaved={() => {}} />); }
it("shows the selected branch, restores per-level inheritance and submits the reviewed version", async () => {
  api.mockResolvedValue({ saved: true }); editor();
  expect(screen.getByRole("dialog").textContent).toContain("Civic Center");
  expect((screen.getByLabelText("Retail branch price (₦)") as HTMLInputElement).value).toBe("120");
  fireEvent.change(screen.getByLabelText("Retail branch price (₦)"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Save branch prices" }));
  await waitFor(() => expect(api).toHaveBeenCalledWith("saveBranchSalesPrice", expect.objectContaining({ branchId: "civic", productId: "panel", sellingPriceMinor: null, wholesalePriceMinor: 9000, expectedVersion: 3 })));
});
it("requires a reason for a below-default level and retains input after rejection", async () => {
  api.mockRejectedValue(new Error("Branch prices changed. Refresh and review before saving.")); editor();
  fireEvent.change(screen.getByLabelText("Wholesale branch price (₦)"), { target: { value: "70" } });
  const save = screen.getByRole("button", { name: "Save branch prices" }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Approval reason (required)"), { target: { value: "Approved local discount" } });
  fireEvent.click(save);
  expect((await screen.findByRole("alert")).textContent).toContain("Branch prices changed");
  expect((screen.getByLabelText("Wholesale branch price (₦)") as HTMLInputElement).value).toBe("70");
});

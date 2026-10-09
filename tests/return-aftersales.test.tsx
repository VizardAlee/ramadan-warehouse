// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ReturnAftersales } from "@/features/returns/return-aftersales";
import type { SaleReturn } from "@/types/domain";
const call = vi.hoisted(() => vi.fn());
afterEach(() => { cleanup(); vi.resetAllMocks(); });
vi.mock("@/features/administration/api", () => ({ callAdministration: call }));
const record = { id: "return-one", status: "approved", inspectionStatus: "completed", customerId: "customer", items: [{ id: "item", productName: "Battery", quantity: 1, disposition: "repair", serialNumbers: [] }] } as unknown as SaleReturn;
it("preserves the exact retry after an uncertain response", async () => {
  call.mockRejectedValueOnce(new Error("Network interrupted")).mockResolvedValueOnce({ caseId: "case" });
  const complete = vi.fn();
  render(<ReturnAftersales record={record} canRoute onComplete={complete} />);
  expect(screen.getByRole("button", { name: "Send to aftersales" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Returned item for aftersales"), { target: { value: JSON.stringify(["item", null]) } });
  fireEvent.change(screen.getByLabelText("Service request"), { target: { value: "Repair battery terminals" } });
  fireEvent.click(screen.getByRole("button", { name: "Send to aftersales" }));
  await screen.findByRole("button", { name: "Retry same service request" });
  expect(screen.getByLabelText("Service request")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Retry same service request" }));
  await waitFor(() => expect(complete).toHaveBeenCalledOnce());
  expect(call.mock.calls[0]).toEqual(call.mock.calls[1]);
});
it("shows existing case links to read-only users", () => {
  render(<ReturnAftersales record={{ ...record, items: [{ ...record.items![0], aftersalesCaseLinks: [{ caseId: "linked", serialNumber: null, quantity: 1 }] }] }} canRoute={false} onComplete={vi.fn()} />);
  expect(screen.getByRole("link", { name: /Open service case/ })).toHaveAttribute("href", "/aftersales?caseId=linked");
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

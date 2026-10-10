// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/features/administration/api", () => ({ callAdministration: mocks.call }));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => ({ profile: { id: "manager", status: "active", displayName: "Manager" } }) }));
vi.mock("@/lib/permissions/roles", () => ({ hasPermission: () => true, hasRole: () => true }));
vi.mock("@/features/administration/use-organization-collection", () => ({ useOrganizationCollection: (name: string) => ({ data: name === "stockCounts" ? [{ id: "count-1", countNumber: "COUNT-001", locationId: "store-1", status: "reviewed", countDate: "2026-10-10", postingEffectiveAt: "2026-10-10T09:00:00Z", postingReason: "Original approved physical count" }] : [] }) }));
import CountsPage from "@/app/(protected)/inventory/counts/page";

afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe("stock count resumption", () => {
  it("keeps entered quantities and the current page when saving fails", async () => {
    mocks.call.mockImplementation((name: string) => name === "submitStockCount" ? Promise.reject(new Error("Connection interrupted; retry this page.")) : Promise.resolve({ count: { id: "count-1", countNumber: "COUNT-001", status: "in_progress", assignedUserIds: ["manager"] }, nextCursor: "line-1", items: [{ id: "line-1", sku: "RETAIN", countedQuantity: null }] }));
    render(<CountsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const input = await screen.findByLabelText("Counted quantity for RETAIN");
    input.focus();
    fireEvent.change(input, { target: { value: "4" } });
    fireEvent.blur(input);
    await waitFor(() => expect((screen.getByRole("button", { name: "Next items" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Next items" }));
    await waitFor(() => expect(screen.getAllByText("Connection interrupted; retry this page.").length).toBeGreaterThan(0));
    expect((input as HTMLInputElement).value).toBe("4");
    expect(mocks.call.mock.calls.filter(call => call[0] === "getStockCountWorkspace")).toHaveLength(1);
  });

  it("saves a page before opening the next page and does not silently submit blank quantities", async () => {
    const count = { id: "count-1", countNumber: "COUNT-001", status: "in_progress", assignedUserIds: ["manager"] };
    mocks.call.mockImplementation((name: string, input: { cursor?: string }) => {
      if (name === "submitStockCount") return Promise.resolve({ saved: true, submitted: false });
      return Promise.resolve({ count, nextCursor: input.cursor ? null : "line-1", items: input.cursor ? [{ id: "line-2", sku: "SECOND", countedQuantity: null }] : [{ id: "line-1", sku: "FIRST", countedQuantity: null }] });
    });
    render(<CountsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByLabelText("Counted quantity for FIRST")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Submit complete count" }));
    await waitFor(() => expect(screen.getAllByText(/Enter a physical count for every line/).length).toBeGreaterThan(0));
    expect(mocks.call.mock.calls.some(call => call[0] === "submitStockCount")).toBe(false);
    fireEvent.change(screen.getByLabelText("Counted quantity for FIRST"), { target: { value: "0" } });
    await waitFor(() => expect((screen.getByRole("button", { name: "Next items" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Next items" }));
    expect(await screen.findByLabelText("Counted quantity for SECOND")).toBeTruthy();
    expect(mocks.call).toHaveBeenCalledWith("submitStockCount", expect.objectContaining({ saveOnly: true, items: [{ itemId: "line-1", countedQuantity: 0, serialNumbers: [] }] }));
    expect(mocks.call).toHaveBeenCalledWith("getStockCountWorkspace", expect.objectContaining({ cursor: "line-1", limit: 25 }));
    fireEvent.click(screen.getByRole("button", { name: "Previous items" }));
    await waitFor(() => expect((screen.getByLabelText("Counted quantity for FIRST") as HTMLInputElement).value).toBe("0"));
  });

  it("shows interrupted posting and resends the original count reason", async () => {
    mocks.call.mockResolvedValue({ posted: true });
    render(<CountsPage />);
    expect(screen.getByText("Posting started. Resume this count to finish safely.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Resume posting" }));
    await waitFor(() => expect(mocks.call).toHaveBeenCalledWith("postStockCount", expect.objectContaining({ stockCountId: "count-1", reason: "Original approved physical count" })));
    expect(await screen.findByText("Post count completed.")).toBeTruthy();
  });
  it("explains that a failed response must not start another count", async () => {
    mocks.call.mockRejectedValue(new Error("That accounting month is closed."));
    render(<CountsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Resume posting" }));
    expect(await screen.findByText(/Some lines may already be posted/)).toBeTruthy();
    expect(screen.getByText(/That accounting month is closed/)).toBeTruthy();
  });
});

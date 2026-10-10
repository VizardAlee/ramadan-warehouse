// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/features/administration/api", () => ({ callAdministration: mocks.call }));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => ({ profile: { id: "manager", status: "active", displayName: "Manager" } }) }));
vi.mock("@/lib/permissions/roles", () => ({ hasPermission: () => true }));
vi.mock("@/features/administration/use-organization-collection", () => ({ useOrganizationCollection: (name: string) => ({ data: name === "stockCounts" ? [{ id: "count-1", countNumber: "COUNT-001", locationId: "store-1", status: "reviewed", countDate: "2026-10-10", postingEffectiveAt: "2026-10-10T09:00:00Z", postingReason: "Original approved physical count" }] : [] }) }));
import CountsPage from "@/app/(protected)/inventory/counts/page";

afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe("stock count resumption", () => {
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

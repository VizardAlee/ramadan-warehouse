// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditList } from "../src/features/audit/audit-list";
import type { ActivityPage } from "../src/features/audit/activity-types";
import type { UserProfile } from "../src/types/domain";
const mocks = vi.hoisted(() => ({ profile: null as UserProfile | null, call: vi.fn() }));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => ({ profile: mocks.profile }) }));
vi.mock("@/features/administration/api", () => ({ callAdministration: (...args: unknown[]) => mocks.call(...args) }));
// Any remaining broad collection subscription is a regression, even for an authorized reader.
vi.mock("@/features/administration/use-organization-collection", () => ({ useOrganizationCollection: () => { throw new Error("No raw audit or users subscription is allowed"); } }));
const profile = { uid: "admin-1", organizationId: "org-1", authorizationVersion: 1, displayName: "Aliyu", status: "active", roleId: "system_administrator", roleIds: ["system_administrator"] } as UserProfile;
const page = (change: Partial<ActivityPage> = {}): ActivityPage => ({ rows: [{ id: "audit-1", actorUserId: "admin-1", actorRoleId: "system_administrator", actorName: "Aliyu", actorNameEvidence: "current_name", action: "purchase_order.approved", module: "purchase_order", entityType: "purchaseOrder", entityId: "opaque-purchase-id", correlationId: "trace-id", sourceFunction: "approvePurchaseOrder", createdAt: "2026-09-28T18:23:00.000Z", reference: "PO-2026-000001", reason: null, location: null }], scanned: 1, scanLimited: false, nextCursor: null, note: "Recorded events only", ...change });
beforeEach(() => { mocks.profile = profile; mocks.call.mockReset().mockResolvedValue(page()); });
afterEach(cleanup);
describe("server-paged audit history", () => {
  it("shows readable activity, current-name evidence and collapsed technical details", async () => {
    render(<AuditList />);
    expect(await screen.findByText("Approved a purchase order")).toBeTruthy();
    expect(screen.getByText("PO-2026-000001")).toBeTruthy(); expect(screen.getByText("Aliyu")).toBeTruthy();
    expect(screen.getByText("Current name · historical name not recorded")).toBeTruthy();
    const disclosure = screen.getByText("Technical details").closest("details"); expect(disclosure?.open).toBe(false);
    fireEvent.click(screen.getByText("Technical details")); expect(disclosure?.open).toBe(true);
    expect(screen.getByText("opaque-purchase-id")).toBeTruthy(); expect(mocks.call.mock.calls[0]?.[0]).toBe("getUserActivity");
  });
  it.each([null, { ...profile, roleId: "operations_administrator", roleIds: ["operations_administrator"], effectivePermissions: ["audit.read"] }, { ...profile, effectivePermissions: [] }, { ...profile, roleIds: [] }, { ...profile, authDisabled: true }])("does not request history without exact stored audit authority (%j)", async denied => {
    mocks.profile = denied as UserProfile | null; render(<AuditList />);
    expect(screen.getByText("Audit access restricted")).toBeTruthy(); expect(mocks.call).not.toHaveBeenCalled();
  });
  it("continues an empty scan and applies edited filters only on submission, resetting the cursor", async () => {
    mocks.call.mockResolvedValueOnce(page({ rows: [], scanned: 1000, scanLimited: true, nextCursor: "cursor-1" })).mockResolvedValue(page());
    render(<AuditList />); expect(await screen.findByText("No matches in this scan")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continue scanning" })); await screen.findByText("Approved a purchase order");
    expect(mocks.call.mock.calls[1]?.[1].cursor).toBe("cursor-1");
    fireEvent.change(screen.getByLabelText("Actor user ID"), { target: { value: "user-2" } }); expect(mocks.call).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Apply filters / refresh" }));
    await waitFor(() => expect(mocks.call).toHaveBeenCalledTimes(3)); expect(mocks.call.mock.calls[2]?.[1]).toMatchObject({ actorUserId: "user-2", cursor: undefined });
  });
  it("discards data immediately on access loss and ignores old in-flight responses", async () => {
    let resolve!: (value: ActivityPage) => void;
    mocks.call.mockReturnValue(new Promise<ActivityPage>(done => { resolve = done; }));
    const rendered = render(<AuditList />); mocks.profile = { ...profile, effectivePermissions: [] }; rendered.rerender(<AuditList />);
    resolve(page()); await waitFor(() => expect(screen.getByText("Audit access restricted")).toBeTruthy()); expect(screen.queryByText("Aliyu")).toBeNull();
    mocks.profile = { ...profile, uid: "admin-2", organizationId: "org-2" }; mocks.call.mockResolvedValue(page({ rows: [] })); rendered.rerender(<AuditList />);
    await screen.findByText("No audit records match"); expect(screen.queryByText("PO-2026-000001")).toBeNull();
  });
});

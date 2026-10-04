// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuditList } from "../src/features/audit/audit-list";

vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({ profile: { uid: "admin-1", displayName: "Aliyu", status: "active", roleId: "system_administrator", roleIds: ["system_administrator"] } }),
}));
vi.mock("@/features/administration/use-organization-collection", () => ({
  useOrganizationCollection: (name: string) => name === "users"
    ? { data: [{ id: "admin-1", uid: "admin-1", displayName: "Aliyu" }], loading: false, error: null }
    : { data: [{
        id: "audit-1", organizationId: "org-1", actorUserId: "admin-1",
        actorRoleId: "system_administrator", action: "purchase_order.approved",
        entityType: "purchaseOrder", entityId: "opaque-purchase-id",
        correlationId: "opaque-trace-id", sourceFunction: "approvePurchaseOrder",
        createdAt: "2026-09-28T18:23:00.000Z",
        after: { purchaseOrderNumber: "PO-2026-000001" },
      }], loading: false, error: null },
}));

afterEach(cleanup);

describe("audit history", () => {
  it("shows readable activity and hides implementation details until requested", () => {
    render(<AuditList />);
    expect(screen.getByText("Approved a purchase order")).toBeTruthy();
    expect(screen.getByText("PO-2026-000001")).toBeTruthy();
    expect(screen.getByText("Aliyu")).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: "Source" })).toBeNull();
    const disclosure = screen.getByText("Technical details").closest("details");
    expect(disclosure?.open).toBe(false);
    fireEvent.click(screen.getByText("Technical details"));
    expect(disclosure?.open).toBe(true);
    expect(screen.getByText("opaque-purchase-id")).toBeTruthy();
  });
});

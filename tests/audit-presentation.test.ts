import { describe, expect, it } from "vitest";
import {
  auditActionTitle,
  auditEntityLabel,
  auditRecordReference,
  auditRoleLabel,
  auditTimestamp,
} from "../src/features/audit/presentation";
import type { AuditLog } from "../src/types/domain";

describe("plain-language audit presentation", () => {
  it("turns business action codes into readable events", () => {
    expect(auditActionTitle("purchase_order.approved")).toBe("Approved a purchase order");
    expect(auditActionTitle("user.created")).toBe("Created a user");
    expect(auditActionTitle("sales_order.payment_confirmed_inventory_released")).toBe("Confirmed payment and released sale stock");
    expect(auditActionTitle("user.invitation_reissued")).toBe("Sent a new user invitation");
    expect(auditActionTitle("aftersales_case.staff_assigned")).toBe("Assigned or changed the staff responsible for service");
    expect(auditActionTitle("somethingNewHappened")).toBe("Recorded something new happened");
  });

  it("uses business references where available without inventing one", () => {
    const log: AuditLog = {
      id: "audit-1", organizationId: "org-1", actorUserId: "user-1",
      actorRoleId: "system_administrator", action: "purchase_order.approved",
      entityType: "purchaseOrder", entityId: "purchase-1", correlationId: "trace-1",
      sourceFunction: "approvePurchaseOrder", createdAt: "2026-09-28T18:23:00.000Z",
      after: { purchaseOrderNumber: "PO-2026-000001" },
    };
    expect(auditEntityLabel(log.entityType)).toBe("Purchase order");
    expect(auditRecordReference(log)).toBe("PO-2026-000001");
    expect(auditRecordReference({ ...log, after: {} })).toBeNull();
    expect(auditRoleLabel("attendance_connector")).toBe("Attendance device");
  });

  it("sorts Firestore timestamps and ISO dates by actual time", () => {
    expect(auditTimestamp({ seconds: 1_700_000_000, nanoseconds: 0 })).toBe(1_700_000_000_000);
    expect(auditTimestamp("2026-09-28T18:23:00.000Z")).toBe(Date.parse("2026-09-28T18:23:00.000Z"));
  });
});

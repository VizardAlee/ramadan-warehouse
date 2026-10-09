import { describe, expect, it } from "vitest";
import { notificationActionFor, supportsInAppDelivery, type InboxCandidate } from "../functions/src/notifications/in-app";

const user = (overrides: Partial<InboxCandidate> = {}): InboxCandidate => ({
  id: "user-1",
  organizationId: "org-1",
  status: "active",
  roleId: "branch_manager",
  branchIds: ["branch-1"],
  warehouseIds: [],
  ...overrides,
});

describe("in-app notification recipients", () => {
  it("scopes collection reminders to active stock-release staff, including multi-role users", () => {
    const event = { eventType: "sale.collection_waiting", organizationId: "org-1", branchId: "branch-1" };
    expect(supportsInAppDelivery(event.eventType)).toBe(true);
    expect(notificationActionFor(event, user({ roleIds: ["sales_cashier", "branch_manager"] })).eligible).toBe(true);
    expect(notificationActionFor(event, user({ effectivePermissions: ["sales.stock.release", "sales.read.own_branch"] })).eligible).toBe(true);
    expect(notificationActionFor(event, user({ effectivePermissions: ["sales.stock.release"] })).eligible).toBe(false);
    expect(notificationActionFor(event, user({ roleId: "system_administrator", branchIds: [] })).eligible).toBe(true);
    for (const overrides of [{ status: "inactive" }, { authDisabled: true }, { branchIds: ["branch-2"] }, { organizationId: "other" }, { effectivePermissions: ["customers.read"] as InboxCandidate["effectivePermissions"] }])
      expect(notificationActionFor(event, user(overrides)).eligible).toBe(false);
  });
  it("scopes debt reminders to active payment staff in the responsible store", () => {
    const event = { eventType: "customer.debt_overdue", organizationId: "org-1", branchId: "branch-1" };
    expect(notificationActionFor(event, user())).toEqual({ eligible: true, actionRequired: true });
    expect(notificationActionFor(event, user({ status: "inactive" })).eligible).toBe(false);
    expect(notificationActionFor(event, user({ branchIds: ["branch-2"] })).eligible).toBe(false);
    expect(notificationActionFor(event, user({ organizationId: "other" })).eligible).toBe(false);
    expect(notificationActionFor(event, user({ effectivePermissions: ["customers.read"] })).eligible).toBe(false);
    expect(notificationActionFor(event, user({ effectivePermissions: ["customers.read", "customers.payment.record"] })).eligible).toBe(true);
    expect(notificationActionFor(event, user({ roleId: "system_administrator", branchIds: [] })).eligible).toBe(true);
  });
  it("assigns sales payment actions by permission and branch", () => {
    const received = { eventType: "sales_order.received", organizationId: "org-1", branchId: "branch-1" };
    const accepted = { ...received, eventType: "sales_order.payment_accepted" };
    expect(notificationActionFor(received, user()).actionRequired).toBe(true);
    expect(notificationActionFor(accepted, user({ roleIds: ["sales_cashier", "branch_manager"] })).actionRequired).toBe(true);
    expect(notificationActionFor(accepted, user({ roleId: "sales_cashier" }))).toEqual({ eligible: true, actionRequired: false });
    expect(notificationActionFor(received, user({ branchIds: ["branch-2"] })).eligible).toBe(false);
    expect(notificationActionFor(received, user({ organizationId: "org-2" })).eligible).toBe(false);
    expect(notificationActionFor(received, user({ status: "inactive" })).eligible).toBe(false);
  });

  it("sends simplified transfers to the responsible source then destination", () => {
    const transfer = { organizationId: "org-1", sourceBranchId: "branch-1", destinationBranchId: "branch-2" };
    expect(notificationActionFor({ ...transfer, eventType: "stock_transfer.created" }, user()).actionRequired).toBe(true);
    expect(notificationActionFor({ ...transfer, eventType: "stock_transfer.approve" }, user()).actionRequired).toBe(false);
    expect(notificationActionFor({ ...transfer, eventType: "stock_transfer.approve" }, user({ branchIds: ["branch-2"] })).actionRequired).toBe(true);
    expect(notificationActionFor({ ...transfer, eventType: "stock_transfer.created" }, user({ roleId: "system_administrator", branchIds: [] })).actionRequired).toBe(true);
    expect(notificationActionFor({ ...transfer, eventType: "stock_transfer.created" }, user({ branchIds: ["branch-3"] })).eligible).toBe(false);
  });

  it("limits in-app fanout to supported workflow events", () => {
    expect(supportsInAppDelivery("sales_order.received")).toBe(true);
    expect(supportsInAppDelivery("stock_transfer.approve")).toBe(true);
    expect(supportsInAppDelivery("transfer.cost_submitted")).toBe(false);
  });
});

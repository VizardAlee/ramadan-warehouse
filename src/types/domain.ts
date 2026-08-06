export const roleIds = [
  "system_administrator",
  "operations_administrator",
  "warehouse_manager",
  "warehouse_officer",
  "branch_requester",
  "branch_manager",
  "logistics_officer",
  "finance_officer",
  "auditor",
] as const;

export type RoleId = (typeof roleIds)[number];

export const permissionIds = [
  "organization.manage",
  "branch.manage",
  "warehouse.manage",
  "location.manage",
  "user.manage",
  "role.manage",
  "audit.read",
  "report.read",
  "report.export",
  "request.create",
  "request.approve",
  "transfer.create",
  "transfer.approve",
  "inventory.operate",
  "receipt.confirm",
  "logistics.manage",
  "cost.create",
  "cost.approve",
] as const;

export type PermissionId = (typeof permissionIds)[number];
export type EntityStatus = "active" | "inactive";

export interface UserProfile {
  id: string;
  organizationId: string;
  email: string;
  displayName: string;
  status: EntityStatus;
  roleIds: RoleId[];
  permissionOverrides: PermissionId[];
  branchIds: string[];
  warehouseIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Organization {
  id: string;
  name: string;
  code: string;
  defaultCurrency: "NGN";
  timezone: string;
  status: EntityStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Branch {
  id: string;
  organizationId: string;
  name: string;
  code: string;
  status: EntityStatus;
  address?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Warehouse {
  id: string;
  organizationId: string;
  name: string;
  code: string;
  status: EntityStatus;
  address?: string;
  createdAt: string;
  updatedAt: string;
}

export const inventoryLocationTypes = [
  "warehouse",
  "branch",
  "goods_in_transit",
  "damaged",
  "quarantined",
] as const;

export type InventoryLocationType = (typeof inventoryLocationTypes)[number];

export interface InventoryLocation {
  id: string;
  organizationId: string;
  name: string;
  code: string;
  type: InventoryLocationType;
  warehouseId?: string;
  branchId?: string;
  status: EntityStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLog {
  id: string;
  organizationId: string;
  actorUserId: string;
  actorRoleIds: RoleId[];
  action: string;
  entityType: string;
  entityId: string;
  reason?: string;
  correlationId: string;
  sourceFunction: string;
  createdAt: string;
}

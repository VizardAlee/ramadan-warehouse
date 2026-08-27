export const roleIds = [
  "system_administrator",
  "operations_administrator",
  "warehouse_manager",
  "warehouse_officer",
  "branch_requester",
  "branch_manager",
  "sales_cashier",
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
  "products.read",
  "products.create",
  "products.update",
  "inventory.read",
  "inventory.receive",
  "inventory.opening_stock",
  "inventory.move_internal",
  "inventory.adjust",
  "inventory.reverse",
  "inventory.count",
  "inventory.count_review",
  "inventory.reconcile",
  "inventory.cost.read",
  "inventory.cost.manage",
  "reports.inventory.read",
  "reports.inventory.export",
  "requests.read.own_branch",
  "requests.read.all",
  "requests.create",
  "requests.update_draft",
  "requests.submit",
  "requests.cancel_own",
  "requests.review",
  "requests.request_changes",
  "requests.approve",
  "requests.reject",
  "requests.cancel_approved",
  "requests.close",
  "requests.cost.read",
  "reports.requests.read",
  "reports.requests.export",
  "transfers.read.own_branch",
  "transfers.read.assigned_warehouse",
  "transfers.read.all",
  "transfers.create.from_request",
  "transfers.create.direct",
  "transfers.update_draft",
  "transfers.submit",
  "transfers.review",
  "transfers.approve",
  "transfers.cancel",
  "transfers.reserve",
  "transfers.release_reservation",
  "transfers.pick",
  "transfers.check_pick",
  "transfers.pack",
  "transfers.check_pack",
  "transfers.dispatch",
  "transfers.verify_dispatch",
  "transfers.receive",
  "transfers.report_discrepancy",
  "transfers.resolve_discrepancy",
  "transfers.cost.read",
  "transfers.cost.create",
  "transfers.cost.approve",
  "transfers.cost.reconcile",
  "transfers.close",
  "reports.transfers.read",
  "reports.transfers.export",
  "sales.read.own_branch",
  "sales.read.all",
  "sales.create",
  "sales.shift.manage",
  "sales.price.base.manage",
  "sales.price.branch.manage",
  "customers.read",
  "customers.manage",
  "customers.credit.approve",
  "customers.payment.record",
  "sales.credit.create",
  "sales.returns.read",
  "sales.returns.create",
  "sales.returns.approve",
  "reports.sales.read",
  "finance.journal.read",
  "suppliers.read",
  "suppliers.manage",
  "procurement.read",
  "procurement.create",
  "procurement.approve",
  "procurement.receive",
  "payables.read",
  "payables.create",
  "payables.approve",
  "payables.pay",
  "expenses.read",
  "expenses.create",
  "expenses.approve",
  "expenses.pay",
  "banking.read",
  "banking.manage",
  "banking.reconcile",
  "banking.approve",
  "accounting.close.read",
  "accounting.close.prepare",
  "accounting.close.approve",
] as const;
export type PermissionId = (typeof permissionIds)[number];

export interface BankAccount {
  id: string;
  organizationId: string;
  bankName: string;
  accountName: string;
  accountNumberLast4: string;
  ledgerAccountCode: string;
  openingBalanceMinor: number;
  openingDate: string;
  currency: "NGN";
  active: boolean;
}

export interface BankStatementTransaction {
  id: string;
  organizationId: string;
  bankAccountId: string;
  transactionDate: string;
  description: string;
  reference?: string;
  amountMinor: number;
  status: "unmatched" | "matched" | "reconciled";
  journalLineId?: string;
  journalNumber?: string;
  reconciliationId?: string;
}

export interface BankReconciliation {
  id: string;
  organizationId: string;
  bankAccountId: string;
  reconciliationNumber: string;
  periodStart: string;
  periodEnd: string;
  openingBalanceMinor: number;
  closingBalanceMinor: number;
  statementMovementMinor: number;
  ledgerMovementMinor: number;
  differenceMinor: number;
  statementTransactionCount: number;
  journalLineCount: number;
  status: "prepared" | "closed";
  preparedBy: string;
  closedBy?: string;
}

export interface AccountingPeriod {
  id: string;
  organizationId: string;
  periodKey: string;
  periodStart: string;
  periodEnd: string;
  status: "open" | "preparing" | "prepared" | "closed";
  journalEntryCount?: number;
  journalLineCount?: number;
  totalDebitMinor?: number;
  totalCreditMinor?: number;
  trialBalance?: Array<{ accountCode: string; accountName: string; debitMinor: number; creditMinor: number; netMinor: number }>;
  preparedBy?: string;
  closedBy?: string;
}

export interface Customer {
  id: string;
  organizationId: string;
  customerNumber: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  taxId?: string;
  active: boolean;
  creditStatus: "pending" | "approved" | "suspended" | "rejected";
  creditLimitMinor: number;
  outstandingBalanceMinor: number;
  availableCreditMinor: number;
  createdAt: DateTimeValue;
  updatedAt: DateTimeValue;
}

export interface SaleReturn {
  id: string;
  organizationId: string;
  branchId: string;
  saleId: string;
  saleNumber: string;
  receiptNumber: string;
  returnNumber: string;
  customerId?: string | null;
  customerName?: string | null;
  status: "submitted" | "approved";
  resolution: "cash" | "card" | "bank_transfer" | "customer_account" | "exchange_credit";
  reason: string;
  netAmountMinor: number;
  vatAmountMinor: number;
  grossAmountMinor: number;
  restockCostMinor: number;
  createdBy: string;
  createdAt: DateTimeValue;
}

export interface Supplier {
  id: string;
  organizationId: string;
  supplierNumber: string;
  name: string;
  phone?: string;
  email?: string;
  paymentTermsDays: number;
  outstandingBalanceMinor: number;
  active: boolean;
}

export interface PurchaseOrder {
  id: string;
  organizationId: string;
  purchaseOrderNumber: string;
  supplierId: string;
  supplierName: string;
  warehouseId: string;
  warehouseName: string;
  receivingLocationId: string;
  status: "draft" | "submitted" | "approved" | "partially_received" | "received";
  netAmountMinor: number;
  vatAmountMinor: number;
  grossAmountMinor: number;
  createdBy: string;
}

export interface PurchaseOrderItem {
  id: string;
  purchaseOrderId: string;
  productId: string;
  sku: string;
  productName: string;
  trackingType: "quantity" | "serial" | "batch";
  unitOfMeasure: string;
  orderedQuantity: number;
  receivedQuantity: number;
  invoicedQuantity?: number;
  unitCostMinor: number;
  vatRateBasisPoints: number;
}

export interface SupplierInvoice {
  id: string;
  supplierId: string;
  supplierName: string;
  purchaseOrderId: string;
  purchaseOrderNumber: string;
  warehouseId: string;
  supplierInvoiceNumber: string;
  status: "submitted" | "approved" | "partially_paid" | "paid";
  netAmountMinor: number;
  vatAmountMinor: number;
  grossAmountMinor: number;
  outstandingAmountMinor: number;
  createdBy: string;
}

export interface OperatingExpense {
  id: string;
  organizationId: string;
  expenseNumber: string;
  categoryId: string;
  categoryCode: string;
  categoryName: string;
  payeeName: string;
  branchId?: string;
  branchName?: string;
  warehouseId?: string;
  warehouseName?: string;
  expenseDate: string;
  supplierDocumentNumber?: string;
  description: string;
  status: "draft" | "submitted" | "approved" | "partially_paid" | "paid";
  netAmountMinor: number;
  vatAmountMinor: number;
  grossAmountMinor: number;
  outstandingAmountMinor: number;
  currency: "NGN";
  createdBy: string;
  createdAt: DateTimeValue;
}
export type EntityStatus = "active" | "inactive";
export type UserStatus = EntityStatus | "suspended";
export type DateTimeValue = string | { seconds: number; nanoseconds: number };

export interface UserProfile {
  id: string;
  uid: string;
  organizationId: string;
  email: string;
  displayName: string;
  phoneNumber?: string;
  employeeReference?: string;
  status: UserStatus;
  roleId: RoleId;
  roleIds?: RoleId[];
  branchIds: string[];
  warehouseIds: string[];
  authDisabled: boolean;
  authorizationVersion: number;
  invitationStatus?: "pending" | "expired" | "accepted";
  invitationIssuedAt?: DateTimeValue;
  invitationExpiresAt?: DateTimeValue;
  invitationAcceptedAt?: DateTimeValue;
  invitationAttemptCount?: number;
  createdAt: DateTimeValue;
  createdBy: string;
  updatedAt: DateTimeValue;
  updatedBy: string;
  lastRoleChangeAt?: DateTimeValue;
  lastRoleChangedBy?: string;
}
export interface Organization {
  id: string;
  legalName: string;
  tradingName?: string;
  code: string;
  registrationNumber?: string;
  contactEmail?: string;
  phoneNumbers: string[];
  address?: string;
  defaultCurrency: "NGN";
  timezone: string;
  status: EntityStatus;
  createdAt: DateTimeValue;
  updatedAt: DateTimeValue;
}
export interface Branch {
  id: string;
  organizationId: string;
  name: string;
  code: string;
  status: EntityStatus;
  address?: string;
  state?: string;
  contactEmail?: string;
  contactPhone?: string;
  managerUserId?: string;
  createdAt: DateTimeValue;
  updatedAt: DateTimeValue;
}
export interface Warehouse {
  id: string;
  organizationId: string;
  name: string;
  code: string;
  status: EntityStatus;
  address?: string;
  state?: string;
  managerIds: string[];
  createdAt: DateTimeValue;
  updatedAt: DateTimeValue;
}
export const inventoryLocationTypes = [
  "warehouse",
  "branch",
  "goods_in_transit",
  "damaged",
  "quarantined",
  "returned",
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
  systemManaged: boolean;
  createdAt: DateTimeValue;
  updatedAt: DateTimeValue;
}
export interface AuditLog {
  id: string;
  organizationId: string;
  actorUserId: string;
  actorRoleId: RoleId;
  action: string;
  entityType: string;
  entityId: string;
  reason?: string;
  correlationId: string;
  sourceFunction: string;
  createdAt: DateTimeValue;
}

export const branchRequestTypes = [
  "stock_replenishment",
  "customer_installation",
  "project_allocation",
  "emergency_replacement",
  "warranty_replacement",
  "inter_branch_support",
  "internal_use",
  "other",
] as const;
export type BranchRequestType = (typeof branchRequestTypes)[number];
export const branchRequestPriorities = [
  "low",
  "normal",
  "high",
  "urgent",
  "critical",
] as const;
export type BranchRequestPriority = (typeof branchRequestPriorities)[number];
export const branchRequestStatuses = [
  "draft",
  "submitted",
  "under_review",
  "changes_requested",
  "approved",
  "partially_approved",
  "rejected",
  "partially_fulfilled",
  "fulfilled",
  "cancelled",
  "closed",
] as const;
export type BranchRequestStatus = (typeof branchRequestStatuses)[number];
export interface BranchRequest {
  id: string;
  organizationId: string;
  requestNumber: string;
  branchId: string;
  requestType: BranchRequestType;
  priority: BranchRequestPriority;
  purpose: string;
  requiredDate?: DateTimeValue;
  projectReference?: string;
  customerReference?: string;
  warrantyReference?: string;
  status: BranchRequestStatus;
  totalRequestedQuantity: number;
  totalApprovedQuantity: number;
  totalRejectedQuantity: number;
  totalFulfilledQuantity: number;
  totalOutstandingQuantity: number;
  totalCancelledOutstandingQuantity: number;
  itemCount: number;
  version: number;
  createdAt: DateTimeValue;
  createdBy: string;
  updatedAt: DateTimeValue;
  updatedBy: string;
  submittedAt?: DateTimeValue;
  submittedBy?: string;
  reviewedAt?: DateTimeValue;
  reviewedBy?: string;
}
export interface BranchRequestItem {
  id: string;
  organizationId: string;
  requestId: string;
  branchId: string;
  productId: string;
  sku: string;
  productName: string;
  unitOfMeasure: string;
  trackingType: ProductTrackingType;
  requestedQuantity: number;
  approvedQuantity: number;
  rejectedQuantity: number;
  fulfilledQuantity: number;
  outstandingQuantity: number;
  cancelledOutstandingQuantity: number;
  requesterNote?: string;
  reviewerNote?: string;
  itemStatus:
    | "pending"
    | "approved"
    | "partially_approved"
    | "rejected"
    | "partially_fulfilled"
    | "fulfilled"
    | "cancelled";
  createdAt: DateTimeValue;
  updatedAt: DateTimeValue;
}

export const transferStatuses = [
  "draft",
  "submitted",
  "under_review",
  "changes_requested",
  "approved",
  "partially_reserved",
  "reserved",
  "picking",
  "partially_picked",
  "picked",
  "packing",
  "packed",
  "ready_for_dispatch",
  "partially_dispatched",
  "dispatched",
  "partially_received",
  "received",
  "disputed",
  "cost_reconciliation",
  "closed",
  "cancelled",
] as const;
export type TransferStatus = (typeof transferStatuses)[number];
export type TransferSourceType = "branch_request" | "admin_allocation";
export interface WarehouseTransfer {
  id: string;
  organizationId: string;
  transferNumber: string;
  sourceType: TransferSourceType;
  sourceRequestId?: string;
  sourceRequestVersion?: number;
  sourceApprovalId?: string;
  originWarehouseId: string;
  originLocationId: string;
  destinationBranchId: string;
  destinationLocationId: string;
  transitLocationId: string;
  purpose: string;
  priority: BranchRequestPriority;
  status: TransferStatus;
  expectedDispatchDate?: DateTimeValue;
  expectedDeliveryDate?: DateTimeValue;
  totalPlannedQuantity: number;
  totalApprovedQuantity: number;
  totalReservedQuantity: number;
  totalPickedQuantity: number;
  totalPackedQuantity: number;
  totalDispatchedQuantity: number;
  totalReceivedQuantity: number;
  totalDamagedQuantity: number;
  totalMissingQuantity: number;
  totalReturnedQuantity: number;
  totalWrittenOffQuantity: number;
  totalOutstandingQuantity: number;
  estimatedCostMinor: number;
  approvedCostMinor: number;
  actualCostMinor: number;
  costVarianceMinor: number;
  currency: "NGN";
  initiatedAt: DateTimeValue;
  initiatedBy: string;
  version: number;
  createdAt: DateTimeValue;
  createdBy: string;
  updatedAt: DateTimeValue;
  updatedBy: string;
}
export interface TransferItem {
  id: string;
  organizationId: string;
  transferId: string;
  sourceRequestId?: string;
  sourceRequestItemId?: string;
  productId: string;
  sku: string;
  productName: string;
  trackingType: ProductTrackingType;
  unitOfMeasure: string;
  plannedQuantity: number;
  approvedQuantity: number;
  reservedQuantity: number;
  pickedQuantity: number;
  packedQuantity: number;
  dispatchedQuantity: number;
  receivedQuantity: number;
  damagedQuantity: number;
  missingQuantity: number;
  returnedQuantity: number;
  writtenOffQuantity: number;
  rejectedAtReceiptQuantity: number;
  outstandingQuantity: number;
  estimatedUnitCostMinor?: number;
  allocatedTransferCostMinor?: number;
  landedUnitCostMinor?: number;
  itemStatus: string;
  createdAt: DateTimeValue;
  updatedAt: DateTimeValue;
}
export interface StockReservation {
  id: string;
  organizationId: string;
  transferId: string;
  transferItemId: string;
  productId: string;
  sku: string;
  sourceLocationId: string;
  quantity: number;
  releasedQuantity: number;
  consumedQuantity: number;
  remainingQuantity: number;
  serialItemIds?: string[];
  lotAllocations?: Array<{ lotId: string; quantity: number }>;
  status:
    "active" | "partially_consumed" | "consumed" | "released" | "cancelled";
  createdAt: DateTimeValue;
  createdBy: string;
  updatedAt: DateTimeValue;
}
export interface TransferCost {
  id: string;
  organizationId: string;
  transferId: string;
  category: string;
  description: string;
  estimatedAmountMinor: number;
  approvedAmountMinor: number;
  actualAmountMinor: number;
  currency: "NGN";
  status:
    "draft" | "submitted" | "approved" | "rejected" | "incurred" | "reconciled";
  createdBy: string;
  approvedBy?: string;
  createdAt: DateTimeValue;
  updatedAt: DateTimeValue;
}

export const productTrackingTypes = ["quantity", "batch", "serial"] as const;
export type ProductTrackingType = (typeof productTrackingTypes)[number];
export interface ProductCategory {
  id: string;
  organizationId: string;
  name: string;
  code: string;
  description?: string;
  active: boolean;
  createdAt: DateTimeValue;
  createdBy: string;
  updatedAt: DateTimeValue;
  updatedBy: string;
}
export interface Product {
  id: string;
  organizationId: string;
  name: string;
  sku: string;
  normalizedSku: string;
  categoryId?: string;
  categoryName?: string;
  brand?: string;
  model?: string;
  description?: string;
  unitOfMeasure: string;
  trackingType: ProductTrackingType;
  minimumStockLevel?: number;
  reorderLevel?: number;
  defaultUnitCostMinor?: number;
  currency: "NGN";
  active: boolean;
  hasLedgerActivity: boolean;
  createdAt: DateTimeValue;
  createdBy: string;
  updatedAt: DateTimeValue;
  updatedBy: string;
}
export const inventoryTransactionTypes = [
  "opening_balance",
  "inventory_receipt",
  "location_transfer",
  "damage_transfer",
  "quarantine_transfer",
  "quarantine_release",
  "return_to_available",
  "stock_adjustment",
  "stock_count_correction",
  "transfer_dispatch",
  "transfer_receipt",
  "discrepancy_resolution",
  "branch_sale",
  "write_off",
  "reversal",
] as const;
export type InventoryTransactionType =
  (typeof inventoryTransactionTypes)[number];
export interface InventoryTransaction {
  id: string;
  organizationId: string;
  transactionNumber: string;
  transactionType: InventoryTransactionType;
  status: "posted" | "reversed";
  referenceType?: string;
  referenceId?: string;
  referenceNumber?: string;
  effectiveAt: DateTimeValue;
  postedAt: DateTimeValue;
  postedBy: string;
  reason: string;
  notes?: string;
  reversalOfTransactionId?: string;
  idempotencyKey: string;
  correlationId: string;
  createdAt: DateTimeValue;
  createdBy: string;
}
export interface InventoryEntry {
  id: string;
  organizationId: string;
  transactionId: string;
  transactionNumber: string;
  transactionType: InventoryTransactionType;
  productId: string;
  sku: string;
  locationId?: string;
  counterpartyLocationId?: string;
  externalAccount?: string;
  quantityDelta: number;
  unitCostMinor: number;
  valueDeltaMinor: number;
  currency: "NGN";
  lotId?: string;
  serializedItemId?: string;
  serialNumber?: string;
  balanceBefore: number;
  balanceAfter: number;
  effectiveAt: DateTimeValue;
  postedBy: string;
  reason: string;
  createdAt: DateTimeValue;
}
export interface InventoryBalance {
  id: string;
  organizationId: string;
  productId: string;
  sku: string;
  trackingType?: ProductTrackingType;
  locationId: string;
  warehouseId?: string;
  branchId?: string;
  lotId?: string;
  onHandQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  averageUnitCostMinor: number;
  totalValueMinor: number;
  currency: "NGN";
  lastTransactionId: string;
  lastMovementAt: DateTimeValue;
  version: number;
  createdAt: DateTimeValue;
  updatedAt: DateTimeValue;
}
export type SerializedItemStatus =
  | "available"
  | "reserved"
  | "in_transit"
  | "at_branch"
  | "quarantined"
  | "damaged"
  | "returned"
  | "written_off";
export interface SerializedItem {
  id: string;
  organizationId: string;
  productId: string;
  sku: string;
  serialNumber: string;
  normalizedSerialNumber: string;
  currentLocationId: string;
  status: SerializedItemStatus;
  lotId?: string;
  acquisitionUnitCostMinor: number;
  currentUnitCostMinor: number;
  currency: "NGN";
  lastTransactionId: string;
  lastMovementAt: DateTimeValue;
  active: boolean;
  createdAt: DateTimeValue;
  createdBy: string;
  updatedAt: DateTimeValue;
  updatedBy: string;
}
export interface InventoryLot {
  id: string;
  organizationId: string;
  productId: string;
  sku: string;
  lotNumber: string;
  normalizedLotNumber: string;
  quantityReceived: number;
  remainingQuantity: number;
  locationQuantities: Record<string, number>;
  unitCostMinor: number;
  receiptDate: string;
  manufacturingDate?: string;
  expiryDate?: string;
  supplierReference?: string;
  status: EntityStatus;
  lastTransactionId: string;
  createdAt: DateTimeValue;
  createdBy: string;
  updatedAt: DateTimeValue;
  updatedBy: string;
}
export type StockCountStatus =
  "draft" | "in_progress" | "submitted" | "reviewed" | "posted" | "cancelled";
export interface StockCount {
  id: string;
  organizationId: string;
  countNumber: string;
  locationId: string;
  status: StockCountStatus;
  blindCount: boolean;
  assignedUserIds: string[];
  countDate: string;
  notes?: string;
  createdAt: DateTimeValue;
  createdBy: string;
  startedAt?: DateTimeValue;
  submittedAt?: DateTimeValue;
  reviewedAt?: DateTimeValue;
  reviewedBy?: string;
  postedAt?: DateTimeValue;
  postedBy?: string;
  inventoryTransactionId?: string;
}

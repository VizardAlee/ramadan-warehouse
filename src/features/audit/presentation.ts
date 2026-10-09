import type { AuditLog } from "@/types/domain";

function words(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function sentence(value: string) {
  const normalized = words(value);
  return normalized ? normalized[0]!.toUpperCase() + normalized.slice(1) : "Record";
}

const specialActions: Readonly<Record<string, string>> = {
  "accounting.account_saved": "Created or updated an accountant ledger account",
  "tax.rule_proposed": "Proposed a new tax rule version for review",
  "budget.revised": "Created or revised a monthly budget, keeping the previous version",
  "tax.rule_approved": "Reviewed and approved a dated tax rule",
  "tax.rule_rejected": "Reviewed and rejected a tax rule proposal",
  "accounting.manual_journal_posted": "Posted a balanced accountant adjustment",
  "accounting.manual_journal_reversed": "Reversed an accountant adjustment without deleting its history",
  "banking.funds_transferred": "Recorded a completed transfer between company accounts",
  "organization.bootstrap": "Set up the organization",
  "custom_claim.updated": "Updated a user's access",
  "branch_request.changes_requested": "Requested changes to a branch request",
  "branch_request.review_started": "Started reviewing a branch request",
  "branch_request.transfer_fulfilment": "Fulfilled a branch request through a transfer",
  "branch_request.comment_created": "Commented on a branch request",
  "sales_order.payment_accepted": "Recorded a sales-order payment",
  "sales_order.payment_confirmed_inventory_released": "Confirmed payment and released sale stock",
  "sales_order.payment_confirmed_stock_reserved": "Confirmed payment and reserved goods for later collection",
  "sale.goods_collected": "Recorded a customer's physical collection",
  "sale.collection_photo_uploaded": "Uploaded a private photo for customer collection",
  "sale.reservation_cancelled": "Cancelled uncollected goods and released their reservation",
  "sales_order.received": "Received a customer order",
  "sales_order.rejected": "Rejected a customer order",
  "customer.payment_recorded": "Recorded a customer payment",
  "customer.advance_recorded": "Received a customer advance",
  "customer.advance_applied": "Applied a customer advance to unpaid invoices",
  "customer.advance_refunded": "Refunded an unused customer advance",
  "expense.payment_recorded": "Recorded an expense payment",
  "supplier_payment.recorded": "Recorded a supplier payment",
  "supplier.advance_recorded": "Paid a supplier advance",
  "supplier.advance_applied": "Applied a supplier advance to an invoice",
  "supplier.advance_refunded": "Received a refund of unused supplier advance",
  "supplier.return_posted": "Returned goods to a supplier and recorded their credit note",
  "supplier.held_handover_credited": "Recorded supplier credit for goods already handed over",
  "sale_return.inspected": "Inspected returned goods and recorded their condition",
  "sale_return.sent_to_aftersales": "Opened a warranty or repair case for held returned goods",
  "sale_return.held_goods_disposed": "Recorded the final destination of held returned goods",
  "sale_return.supplier_replacement_received": "Received inspected replacement goods from the supplier",
  "supplier_replacement.photo_recorded": "Attached a private photo to a supplier replacement receipt",
  "sale_correction.requested": "Requested a correction to a completed sale",
  "sale_correction.approved": "Approved a sale correction for controlled processing",
  "sale_correction.rejected": "Rejected a sale correction request",
  "sale_correction.completed": "Verified the linked reversals and replacement sale",
  "sale_return.exchange_credit_refunded": "Refunded unused customer exchange credit",
  "inventory.supplier_return": "Released goods back to a supplier",
  "supplier.return_reversed": "Corrected a supplier return and restored stock and supplier balances",
  "aftersales_case.payment_recorded": "Recorded an aftersales payment",
  "transfer.reservation_released": "Released reserved transfer stock",
  "transfer.discrepancy_created": "Reported a transfer discrepancy",
  "transfer.discrepancy_resolved": "Resolved a transfer discrepancy",
  "transfer.pick_verified": "Verified picked transfer stock",
  "inventory.reconciliation_executed": "Reconciled inventory",
  "inventory.transaction_reversed": "Reversed an inventory movement",
  "user.invitation_reissued": "Sent a new user invitation",
  "user.sessions_revoked": "Signed a user out of active sessions",
  "user.branch_assignments_changed": "Changed a user's store assignments",
  "user.warehouse_assignments_changed": "Changed a user's legacy warehouse assignments",
  "employee.compensation_changed": "Changed employee compensation",
  "attendance.imported": "Imported an attendance record",
  "attendance.recorded": "Recorded attendance",
  "bank_transaction.matched": "Matched a bank transaction",
  "bank_transaction.unmatched": "Removed a bank-transaction match",
  "bank_reconciliation.closed": "Completed bank reconciliation",
  "accounting_period.closed": "Closed an accounting period",
  "organization.reset_started": "Started an organization data reset",
  "organization.reset_completed": "Completed an organization data reset",
  "sale.completed": "Completed a sale",
  "pos_shift.opened": "Opened a POS shift",
  "pos_shift.closed": "Closed a POS shift",
  "daily_close.prepared": "Prepared the store's daily close",
  "daily_close.signed": "Signed off the store's daily close",
};

const actionVerbs: Readonly<Record<string, string>> = {
  created: "Created",
  updated: "Updated",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
  closed: "Closed",
  received: "Received",
  dispatched: "Dispatched",
  reserved: "Reserved",
  picked: "Picked",
  posted: "Posted",
  reviewed: "Reviewed",
  started: "Started",
  prepared: "Prepared",
  imported: "Imported",
  completed: "Completed",
  recorded: "Recorded",
  reversed: "Reversed",
};

export function auditEntityLabel(entityType: string) {
  return sentence(entityType || "record");
}

export function auditActionTitle(action: string) {
  if (specialActions[action]) return specialActions[action];
  const split = action.lastIndexOf(".");
  if (split > 0) {
    const entity = words(action.slice(0, split));
    const verb = actionVerbs[action.slice(split + 1)];
    if (verb) {
      const article = entity.startsWith("user") ? "a" : /^[aeiou]/.test(entity) ? "an" : "a";
      return `${verb} ${article} ${entity}`;
    }
  }
  return `Recorded ${words(action) || "an audit event"}`;
}

export function auditRoleLabel(roleId: string) {
  if (roleId === "attendance_connector") return "Attendance device";
  return sentence(roleId || "staff account");
}

export function auditRecordReference(log: AuditLog) {
  const after = log.after ?? {};
  for (const key of [
    "saleNumber", "receiptNumber", "transferNumber", "requestNumber",
    "purchaseOrderNumber", "invoiceNumber", "returnNumber", "expenseNumber",
    "supplierNumber", "customerNumber", "sku", "staffId", "code",
  ]) {
    const value = after[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function auditTimestamp(value: AuditLog["createdAt"]) {
  if (typeof value === "string") return Date.parse(value) || 0;
  return value && typeof value === "object" && "seconds" in value
    ? value.seconds * 1000
    : 0;
}

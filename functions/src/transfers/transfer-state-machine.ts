import type { Permission } from "../auth/authorize.js";

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
  "awaiting_check",
  "packing",
  "packed",
  "ready_for_dispatch",
  "partially_dispatched",
  "dispatched",
  "partially_received",
  "received",
  "disputed",
  "cost_pending",
  "cost_reconciled",
  "cancelled",
  "closed",
] as const;

export type TransferStatus = (typeof transferStatuses)[number];

export interface TransferTransitionDefinition {
  readonly permission: Permission;
  readonly preconditions: readonly string[];
  readonly inventoryMovement: boolean;
  readonly reservationChange: boolean;
  readonly emitsEvent: boolean;
  readonly emitsNotification: boolean;
  readonly terminal: boolean;
}

type TransitionKey = `${TransferStatus}->${TransferStatus}`;

const transition = (
  permission: Permission,
  preconditions: readonly string[] = [],
  options: Partial<Omit<TransferTransitionDefinition, "permission" | "preconditions">> = {},
): TransferTransitionDefinition => ({
  permission,
  preconditions,
  inventoryMovement: false,
  reservationChange: false,
  emitsEvent: true,
  emitsNotification: true,
  terminal: false,
  ...options,
});

export const transferTransitions: Readonly<
  Partial<Record<TransitionKey, TransferTransitionDefinition>>
> = {
  "draft->submitted": transition("transfers.submit", ["has_items"]),
  "changes_requested->submitted": transition("transfers.submit", ["has_items"]),
  "submitted->under_review": transition("transfers.review"),
  "submitted->changes_requested": transition("transfers.review"),
  "under_review->changes_requested": transition("transfers.review"),
  "submitted->approved": transition("transfers.approve", ["maker_checker"]),
  "under_review->approved": transition("transfers.approve", ["maker_checker"]),
  "submitted->cancelled": transition("transfers.approve", ["maker_checker"], {
    terminal: true,
  }),
  "under_review->cancelled": transition("transfers.approve", ["maker_checker"], {
    terminal: true,
  }),
  "approved->partially_reserved": transition("transfers.reserve", ["stock_available"], {
    reservationChange: true,
  }),
  "approved->reserved": transition("transfers.reserve", ["stock_available"], {
    reservationChange: true,
  }),
  "partially_reserved->partially_reserved": transition("transfers.reserve", ["stock_available"], {
    reservationChange: true,
  }),
  "partially_reserved->reserved": transition("transfers.reserve", ["stock_available"], {
    reservationChange: true,
  }),
  "partially_reserved->approved": transition("transfers.release_reservation", [], {
    reservationChange: true,
  }),
  "reserved->approved": transition("transfers.release_reservation", [], {
    reservationChange: true,
  }),
  "reserved->picking": transition("transfers.pick", ["reservation_active"]),
  "picking->awaiting_check": transition("transfers.pick", ["pick_recorded"]),
  "picking->partially_picked": transition("transfers.pick", ["pick_recorded"]),
  "picking->picked": transition("transfers.pick", ["pick_recorded"]),
  "partially_picked->partially_picked": transition("transfers.pick", ["pick_recorded"]),
  "partially_picked->picked": transition("transfers.pick", ["pick_recorded"]),
  "awaiting_check->picking": transition("transfers.check_pick", ["pick_rejected"]),
  "awaiting_check->packing": transition("transfers.check_pick", ["independent_checker"]),
  "packing->packing": transition("transfers.pack", ["package_not_duplicate"]),
  "packing->packed": transition("transfers.check_pack", ["all_packages_sealed"]),
  "picked->packing": transition("transfers.pack", ["pick_verified"]),
  "partially_picked->packing": transition("transfers.pack", ["pick_verified"]),
  "packing->ready_for_dispatch": transition("transfers.pack", ["all_packages_sealed"]),
  "ready_for_dispatch->partially_dispatched": transition("transfers.dispatch", ["dispatch_verified"], {
    inventoryMovement: true,
    reservationChange: true,
  }),
  "ready_for_dispatch->dispatched": transition("transfers.dispatch", ["dispatch_verified"], {
    inventoryMovement: true,
    reservationChange: true,
  }),
  "packed->partially_dispatched": transition("transfers.dispatch", ["dispatch_verified"], {
    inventoryMovement: true,
    reservationChange: true,
  }),
  "packed->dispatched": transition("transfers.dispatch", ["dispatch_verified"], {
    inventoryMovement: true,
    reservationChange: true,
  }),
  "partially_dispatched->partially_dispatched": transition("transfers.dispatch", ["dispatch_verified"], {
    inventoryMovement: true,
    reservationChange: true,
  }),
  "partially_dispatched->dispatched": transition("transfers.dispatch", ["dispatch_verified"], {
    inventoryMovement: true,
    reservationChange: true,
  }),
  "partially_dispatched->partially_received": transition("transfers.receive", ["receipt_within_dispatch"], {
    inventoryMovement: true,
  }),
  "dispatched->partially_received": transition("transfers.receive", ["receipt_within_dispatch"], {
    inventoryMovement: true,
  }),
  "dispatched->received": transition("transfers.receive", ["receipt_within_dispatch"], {
    inventoryMovement: true,
  }),
  "partially_received->partially_received": transition("transfers.receive", ["receipt_within_dispatch"], {
    inventoryMovement: true,
  }),
  "partially_received->received": transition("transfers.receive", ["receipt_within_dispatch"], {
    inventoryMovement: true,
  }),
  "dispatched->disputed": transition("transfers.receive", ["discrepancy_recorded"], {
    inventoryMovement: true,
  }),
  "partially_received->disputed": transition("transfers.receive", ["discrepancy_recorded"], {
    inventoryMovement: true,
  }),
  "disputed->partially_received": transition("transfers.resolve_discrepancy", ["disposition_posted"], {
    inventoryMovement: true,
  }),
  "disputed->received": transition("transfers.resolve_discrepancy", ["all_discrepancies_resolved"], {
    inventoryMovement: true,
  }),
  "received->cost_pending": transition("transfers.cost.reconcile", ["costs_submitted"]),
  "received->cost_reconciled": transition("transfers.cost.reconcile", ["costs_reconciled"]),
  "cost_pending->cost_reconciled": transition("transfers.cost.reconcile", ["costs_reconciled"]),
  "approved->cancelled": transition("transfers.cancel", ["nothing_dispatched"], {
    reservationChange: true,
    terminal: true,
  }),
  "partially_reserved->cancelled": transition("transfers.cancel", ["nothing_dispatched"], {
    reservationChange: true,
    terminal: true,
  }),
  "reserved->cancelled": transition("transfers.cancel", ["nothing_dispatched"], {
    reservationChange: true,
    terminal: true,
  }),
  "received->closed": transition("transfers.close", ["closure_invariants"], { terminal: true }),
  "cost_reconciled->closed": transition("transfers.close", ["closure_invariants"], { terminal: true }),
} as const;

export function isTransferStatus(value: unknown): value is TransferStatus {
  return typeof value === "string" && transferStatuses.includes(value as TransferStatus);
}

export function getTransferTransition(
  current: string,
  next: string,
): TransferTransitionDefinition | undefined {
  if (!isTransferStatus(current) || !isTransferStatus(next)) return undefined;
  return transferTransitions[`${current}->${next}`];
}

export function assertTransferTransition(current: string, next: string): TransferTransitionDefinition {
  const definition = getTransferTransition(current, next);
  if (!definition) {
    const error = new Error(`INVALID_STATE_TRANSITION: ${current} -> ${next}`);
    error.name = "InvalidTransferStateTransition";
    throw error;
  }
  return definition;
}

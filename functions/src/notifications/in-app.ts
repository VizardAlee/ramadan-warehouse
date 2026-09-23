import { FieldValue, Timestamp, type Transaction } from "firebase-admin/firestore";
import { db } from "../admin.js";
import {
  hasRole,
  hasServerPermission,
  normalizeRoleIds,
  type AccessProfile,
} from "../auth/authorize.js";
import type { DeliveryResult, NotificationEvent } from "./delivery.js";

type SupportedEvent =
  | "sales_order.received"
  | "sales_order.payment_accepted"
  | "sales_order.completed"
  | "stock_transfer.created"
  | "stock_transfer.approve"
  | "stock_transfer.receive"
  | "stock_transfer.report_problem"
  | "stock_transfer.resolve";

const supported = new Set<SupportedEvent>([
  "sales_order.received",
  "sales_order.payment_accepted",
  "sales_order.completed",
  "stock_transfer.created",
  "stock_transfer.approve",
  "stock_transfer.receive",
  "stock_transfer.report_problem",
  "stock_transfer.resolve",
]);

export function supportsInAppDelivery(eventType: string): eventType is SupportedEvent {
  return supported.has(eventType as SupportedEvent);
}

export interface InboxCandidate {
  id: string;
  organizationId: string;
  status: string;
  authDisabled?: boolean;
  roleId?: string;
  roleIds?: string[];
  branchIds?: string[];
  warehouseIds?: string[];
}

export interface InboxEvent extends NotificationEvent {
  organizationId: string;
  entityId: string;
  branchId?: string | null;
  sourceBranchId?: string | null;
  destinationBranchId?: string | null;
  warehouseId?: string | null;
  referenceNumber?: string | null;
  createdAt?: Timestamp;
}

export function writeInAppEvent(
  transaction: Transaction,
  input: {
    organizationId: string;
    entityId: string;
    eventType: SupportedEvent;
    branchId?: string;
    referenceNumber?: string;
    actorUserId: string;
  },
): void {
  const eventId = `${input.eventType.replaceAll(".", "_")}_${input.entityId}`;
  transaction.create(db.doc(`notificationEvents/${eventId}`), {
    organizationId: input.organizationId,
    entityId: input.entityId,
    entityType: "salesOrder",
    eventType: input.eventType,
    templateKey: `${input.eventType.replaceAll(".", "_")}_v1`,
    branchId: input.branchId ?? null,
    referenceNumber: input.referenceNumber ?? null,
    actorUserId: input.actorUserId,
    recipientIds: [],
    recipientRoles: [],
    idempotencyKey: eventId,
    status: "pending",
    attemptCount: 0,
    createdAt: FieldValue.serverTimestamp(),
  });
}

function actorFor(candidate: InboxCandidate): AccessProfile | null {
  const roleIds = normalizeRoleIds(candidate.roleIds, candidate.roleId);
  if (
    candidate.status !== "active" || candidate.authDisabled ||
    !candidate.organizationId || roleIds.length === 0
  ) return null;
  return {
    userId: candidate.id,
    organizationId: candidate.organizationId,
    roleId: roleIds[0]!,
    roleIds,
    branchIds: candidate.branchIds ?? [],
    warehouseIds: candidate.warehouseIds ?? [],
    authorizationVersion: 1,
  };
}

function organizationWide(actor: AccessProfile): boolean {
  return hasRole(actor, "system_administrator") || hasRole(actor, "operations_administrator");
}

export function notificationActionFor(
  event: Pick<InboxEvent, "eventType" | "organizationId" | "branchId" | "sourceBranchId" | "destinationBranchId" | "warehouseId">,
  candidate: InboxCandidate,
): { eligible: boolean; actionRequired: boolean } {
  const actor = actorFor(candidate);
  if (!actor || actor.organizationId !== event.organizationId)
    return { eligible: false, actionRequired: false };
  const wide = organizationWide(actor);
  if (event.eventType.startsWith("sales_order.")) {
    const atBranch = Boolean(event.branchId && actor.branchIds.includes(event.branchId));
    if (!wide && !atBranch) return { eligible: false, actionRequired: false };
    const canAccept = hasServerPermission(actor, "sales.payment.accept");
    const canConfirm = hasServerPermission(actor, "sales.payment.confirm");
    return {
      eligible: canAccept || canConfirm,
      actionRequired:
        event.eventType === "sales_order.received" ? canAccept :
        event.eventType === "sales_order.payment_accepted" ? canConfirm : false,
    };
  }
  const sourceBranch = event.sourceBranchId;
  const destinationBranch = event.destinationBranchId ?? event.branchId;
  const sourceManager = Boolean(
    (sourceBranch && actor.branchIds.includes(sourceBranch) && hasRole(actor, "branch_manager")) ||
    (event.warehouseId && actor.warehouseIds.includes(event.warehouseId) && hasRole(actor, "warehouse_manager")),
  );
  const destinationManager = Boolean(
    destinationBranch && actor.branchIds.includes(destinationBranch) && hasRole(actor, "branch_manager"),
  );
  if (!wide && !sourceManager && !destinationManager)
    return { eligible: false, actionRequired: false };
  return {
    eligible: true,
    actionRequired:
      event.eventType === "stock_transfer.created" ? wide || sourceManager :
      event.eventType === "stock_transfer.approve" ? wide || destinationManager :
      event.eventType === "stock_transfer.report_problem" ? wide || sourceManager : false,
  };
}

function display(event: InboxEvent): { title: string; body: string; href: string } {
  const reference = event.referenceNumber || "this item";
  const entityId = encodeURIComponent(event.entityId);
  switch (event.eventType) {
    case "sales_order.received":
      return { title: "Order ready for payment", body: `${reference} has been received. Record its payment when ready.`, href: "/pos" };
    case "sales_order.payment_accepted":
      return { title: "Payment needs confirmation", body: `Review the payment for ${reference} before completing the sale.`, href: "/pos" };
    case "sales_order.completed":
      return { title: "Sale completed", body: `${reference} has been confirmed and posted.`, href: "/pos" };
    case "stock_transfer.created":
      return { title: "Stock transfer needs source confirmation", body: `${reference} is ready for the source manager to confirm.`, href: `/transfers/simple/${entityId}` };
    case "stock_transfer.approve":
      return { title: "Stock transfer awaiting receipt", body: `${reference} is ready for the receiving store to acknowledge.`, href: `/transfers/simple/${entityId}` };
    case "stock_transfer.report_problem":
      return { title: "Stock transfer problem reported", body: `Review the issue reported for ${reference}.`, href: `/transfers/simple/${entityId}` };
    case "stock_transfer.receive":
      return { title: "Stock transfer receipt recorded", body: `Receipt was recorded for ${reference}.`, href: `/transfers/simple/${entityId}` };
    default:
      return { title: "Stock transfer updated", body: `${reference} has been updated.`, href: `/transfers/simple/${entityId}` };
  }
}

const expectedStatus: Partial<Record<SupportedEvent, string[]>> = {
  "sales_order.received": ["order_received"],
  "sales_order.payment_accepted": ["payment_accepted"],
  "sales_order.completed": ["completed"],
  "stock_transfer.created": ["requested"],
  "stock_transfer.approve": ["awaiting_receipt"],
  "stock_transfer.report_problem": ["problem"],
};

export async function deliverInAppNotification(event: InboxEvent): Promise<DeliveryResult> {
  if (!supportsInAppDelivery(event.eventType))
    return { delivered: false, retryable: false, errorSummary: "Unsupported in-app event" };
  if (!event.organizationId || !event.entityId)
    return { delivered: false, retryable: false, errorSummary: "Missing event scope" };
  const collectionName = event.eventType.startsWith("sales_order.") ? "salesOrders" : "stockTransfers";
  const entity = await db.doc(`${collectionName}/${event.entityId}`).get();
  if (!entity.exists || entity.get("organizationId") !== event.organizationId)
    return { delivered: false, retryable: false, errorSummary: "Source record unavailable" };
  const expected = expectedStatus[event.eventType];
  // Later transitions supersede an action alert even if the worker sees events out of order.
  if (expected && !expected.includes(String(entity.get("status"))))
    return { delivered: true, providerMessageId: `in_app:superseded:${event.id}` };
  const users = await db.collection("users").where("organizationId", "==", event.organizationId).get();
  const candidates = users.docs
    .map((snapshot) => ({ id: snapshot.id, ...snapshot.data() } as InboxCandidate))
    .map((candidate) => ({ candidate, decision: notificationActionFor(event, candidate) }))
    .filter(({ decision }) => decision.eligible);
  if (!candidates.length)
    return { delivered: false, retryable: false, errorSummary: "No eligible recipient" };
  const content = display(event);
  const occurredAt = event.createdAt instanceof Timestamp ? event.createdAt : Timestamp.now();
  const inboxId = `${collectionName}_${event.entityId}`;
  for (const { candidate, decision } of candidates) {
    const ref = db.doc(`users/${candidate.id}/notifications/${inboxId}`);
    await db.runTransaction(async (transaction) => {
      const existing = await transaction.get(ref);
      const previousAt = existing.get("occurredAt");
      if (previousAt instanceof Timestamp && previousAt.toMillis() > occurredAt.toMillis()) return;
      if (existing.get("eventId") === event.id) return;
      transaction.set(ref, {
        organizationId: event.organizationId,
        recipientId: candidate.id,
        entityType: collectionName === "salesOrders" ? "salesOrder" : "stockTransfer",
        entityId: event.entityId,
        eventId: event.id,
        eventType: event.eventType,
        title: content.title,
        body: content.body,
        href: content.href,
        branchId: event.branchId ?? event.destinationBranchId ?? null,
        actionRequired: decision.actionRequired,
        occurredAt,
        readAt: null,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  }
  return { delivered: true, providerMessageId: `in_app:${event.id}` };
}

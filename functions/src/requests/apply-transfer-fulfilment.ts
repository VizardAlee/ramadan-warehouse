import { FieldValue } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import type { AccessProfile } from "../auth/authorize.js";
import { writeAuditLog } from "../audit/write-audit-log.js";

export interface TransferFulfilmentLine {
  readonly requestItemId: string;
  readonly quantity: number;
}
export interface ApplyTransferFulfilmentInput {
  readonly organizationId: string;
  readonly requestId: string;
  readonly transferId: string;
  readonly receiptId: string;
  readonly lines: readonly TransferFulfilmentLine[];
  readonly correlationId: string;
}

/** Applies only confirmed acceptable receipt quantities and is idempotent by receipt. */
export async function applyTransferFulfilmentToRequest(
  actor: AccessProfile,
  input: ApplyTransferFulfilmentInput,
): Promise<{ applied: boolean }> {
  const requestRef = db.doc(`branchRequests/${input.requestId}`);
  const marker = db.doc(
    `requestFulfilments/${input.requestId}__${input.receiptId}`,
  );
  return db.runTransaction(async (transaction) => {
    const itemRefs = input.lines.map((line) =>
      db.doc(`branchRequestItems/${line.requestItemId}`),
    );
    const snapshots = await transaction.getAll(marker, requestRef, ...itemRefs);
    const existing = snapshots[0]!;
    const request = snapshots[1]!;
    const items = snapshots.slice(2);
    if (existing.exists) return { applied: false };
    if (
      !request.exists ||
      request.get("organizationId") !== input.organizationId ||
      input.organizationId !== actor.organizationId
    )
      throw new HttpsError(
        "failed-precondition",
        "Linked request is unavailable.",
      );
    let applied = 0;
    const now = FieldValue.serverTimestamp();
    for (let index = 0; index < input.lines.length; index++) {
      const line = input.lines[index]!;
      const item = items[index]!;
      if (
        !item.exists ||
        item.get("requestId") !== input.requestId ||
        item.get("organizationId") !== input.organizationId ||
        !Number.isSafeInteger(line.quantity) ||
        line.quantity <= 0
      )
        throw new HttpsError(
          "failed-precondition",
          "Request fulfilment line is invalid.",
        );
      const approved = Number(item.get("approvedQuantity") ?? 0);
      const fulfilled = Number(item.get("fulfilledQuantity") ?? 0);
      if (fulfilled + line.quantity > approved)
        throw new HttpsError(
          "failed-precondition",
          "Fulfilment cannot exceed approved request quantity.",
        );
      const next = fulfilled + line.quantity;
      transaction.update(item.ref, {
        fulfilledQuantity: next,
        outstandingQuantity: approved - next,
        transferAllocatedQuantity: Math.max(
          0,
          Number(item.get("transferAllocatedQuantity") ?? 0) - line.quantity,
        ),
        itemStatus: next === approved ? "fulfilled" : "partially_fulfilled",
        updatedAt: now,
      });
      applied += line.quantity;
    }
    const totalApproved = Number(request.get("totalApprovedQuantity") ?? 0);
    const totalFulfilled =
      Number(request.get("totalFulfilledQuantity") ?? 0) + applied;
    const status =
      totalFulfilled === totalApproved ? "fulfilled" : "partially_fulfilled";
    transaction.update(requestRef, {
      totalFulfilledQuantity: totalFulfilled,
      totalOutstandingQuantity: totalApproved - totalFulfilled,
      status,
      updatedAt: now,
      updatedBy: actor.userId,
    });
    transaction.create(marker, {
      organizationId: input.organizationId,
      requestId: input.requestId,
      transferId: input.transferId,
      receiptId: input.receiptId,
      lines: input.lines,
      quantity: applied,
      createdAt: now,
      createdBy: actor.userId,
    });
    transaction.create(db.collection("branchRequestEvents").doc(), {
      organizationId: input.organizationId,
      requestId: input.requestId,
      branchId: request.get("branchId"),
      eventType: "transfer_fulfilment_received",
      fromStatus: request.get("status"),
      toStatus: status,
      actorUserId: actor.userId,
      actorRoleId: actor.roleId,
      requestVersion: request.get("version"),
      transferId: input.transferId,
      receiptId: input.receiptId,
      quantity: applied,
      correlationId: input.correlationId,
      createdAt: now,
    });
    writeAuditLog(transaction, actor, {
      action: "branch_request.transfer_fulfilment",
      entityType: "branchRequest",
      entityId: input.requestId,
      correlationId: input.correlationId,
      sourceFunction: "confirmTransferReceipt",
      after: {
        transferId: input.transferId,
        receiptId: input.receiptId,
        quantity: applied,
      },
    });
    return { applied: true };
  });
}

export type ApplyTransferFulfilment = (
  actor: AccessProfile,
  input: ApplyTransferFulfilmentInput,
) => Promise<{ applied: boolean }>;

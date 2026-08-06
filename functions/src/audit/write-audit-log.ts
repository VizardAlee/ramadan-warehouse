import { FieldValue, type Transaction } from "firebase-admin/firestore";
import type { AccessProfile } from "../auth/authorize.js";
import { db } from "../admin.js";

export interface AuditEvent {
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly correlationId: string;
  readonly sourceFunction: string;
  readonly reason?: string;
  readonly before?: Readonly<Record<string, unknown>>;
  readonly after?: Readonly<Record<string, unknown>>;
}

export function writeAuditLog(transaction: Transaction, actor: AccessProfile, event: AuditEvent): string {
  const reference = db.collection("auditLogs").doc();
  transaction.create(reference, {
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorRoleIds: actor.roleIds,
    ...event,
    createdAt: FieldValue.serverTimestamp(),
  });
  return reference.id;
}

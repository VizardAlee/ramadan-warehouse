import { FieldValue, type Transaction } from "firebase-admin/firestore";
import type { AccessProfile } from "../auth/authorize.js";
import { db } from "../admin.js";
import { auditLocation, auditModule } from "./activity-projection.js";
import { safeActorName } from "./authority.js";

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

export function writeAuditLog(transaction: Pick<Transaction, "create">, actor: AccessProfile, event: AuditEvent): string {
  const reference = db.collection("auditLogs").doc();
  const record: Record<string, unknown> = {
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorRoleId: actor.roleId,
    actorRoleIds: actor.roleIds ?? [actor.roleId],
    actorDisplayName: safeActorName(actor.displayName),
    module: auditModule(event.action),
    locationEvidence: auditLocation(event.after) ?? undefined,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    correlationId: event.correlationId,
    sourceFunction: event.sourceFunction,
    reason: event.reason,
    before: event.before,
    after: event.after,
    createdAt: FieldValue.serverTimestamp(),
  };
  for (const [key, value] of Object.entries(record)) if (value === undefined) delete record[key];
  transaction.create(reference, record);
  return reference.id;
}

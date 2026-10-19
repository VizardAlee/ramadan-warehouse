import { db } from "../admin.js";
import { safeActorName, validActorUserId } from "./authority.js";

/** Call only with operational records already authorized for this viewer and store. No arbitrary UID endpoint. */
export async function currentActorNames(organizationId: string, userIds: readonly unknown[]) {
  const ids = [...new Set(userIds.filter(validActorUserId))].slice(0, 200);
  const names: Record<string, string> = {};
  if (ids.length) for (const user of await db.getAll(...ids.map(id => db.doc(`users/${id}`)), { fieldMask: ["organizationId", "displayName"] })) {
    if (user.get("organizationId") !== organizationId) continue;
    const name = safeActorName(user.get("displayName")); if (name) names[user.id] = name;
  }
  return names;
}
export const actorFields = ["createdBy", "approvedBy", "postedBy", "recordedBy", "receivedBy", "paymentConfirmedBy", "paymentAcceptedBy"] as const;
export type RecordActors = Partial<Record<typeof actorFields[number], { userId: string; currentName: string | null }>>;
export async function withRecordActors<T extends Record<string, unknown>>(organizationId: string, records: readonly T[]) {
  const names = await currentActorNames(organizationId, records.flatMap(record => actorFields.map(field => record[field])));
  return records.map(record => {
    const actors: RecordActors = {};
    for (const field of actorFields) {
      const id = record[field];
      if (validActorUserId(id)) actors[field] = { userId: id, currentName: names[id] ?? null };
    }
    return { ...record, actorLabels: actors };
  });
}

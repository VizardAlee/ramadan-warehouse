import { FieldPath, Timestamp, type Query, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import { requireAccess } from "../auth/authorize.js";
import { enforceAppCheck } from "../config.js";
import { parseInput } from "../utils/callable.js";
import { activityBounds, activityFingerprint, activityInput, decodeActivityCursor, encodeActivityCursor, matchesActivity } from "../audit/activity-query.js";
import { projectActivity } from "../audit/activity-projection.js";
import { currentActorNames } from "../audit/record-actors.js";

export const getUserActivity = onCall({ enforceAppCheck, timeoutSeconds: 60 }, async request => {
  const actor = await requireAccess(request);
  if (!actor.storedAuditReadAllowed) throw new HttpsError("permission-denied", "Audit history requires existing auditor or administrator audit access.");
  const input = parseInput(activityInput, request.data), bounds = activityBounds(input), fingerprint = activityFingerprint(actor, input);
  let query: Query = db.collection("auditLogs").where("organizationId", "==", actor.organizationId)
    .where("createdAt", ">=", Timestamp.fromMillis(bounds.from)).where("createdAt", "<", Timestamp.fromMillis(bounds.until))
    .orderBy("createdAt", "desc").orderBy(FieldPath.documentId(), "desc");
  if (input.actorUserId) query = query.where("actorUserId", "==", input.actorUserId);
  if (input.cursor) {
    const cursor = decodeActivityCursor(input.cursor, fingerprint), anchor = await db.doc(`auditLogs/${cursor.id}`).get();
    const time = anchor.get("createdAt") as Timestamp | undefined;
    if (!anchor.exists || anchor.get("organizationId") !== actor.organizationId || !(time instanceof Timestamp) || time.seconds !== cursor.seconds || time.nanoseconds !== cursor.nanoseconds || time.toMillis() < bounds.from || time.toMillis() >= bounds.until || (input.actorUserId && anchor.get("actorUserId") !== input.actorUserId))
      throw new HttpsError("invalid-argument", "The audit page is unavailable. Restart this search.");
    query = query.startAfter(anchor);
  }
  const matches: QueryDocumentSnapshot[] = [];
  let scanned = 0, last: QueryDocumentSnapshot | undefined, hasMore = false;
  while (scanned < 1000 && matches.length < input.pageSize) {
    const limit = Math.min(100, 1000 - scanned), page = await query.limit(limit).get();
    if (page.empty) { hasMore = false; break; }
    let processed = 0;
    for (const doc of page.docs) {
      last = doc; scanned++; processed++;
      if (matchesActivity(doc.data(), input)) matches.push(doc);
      if (matches.length === input.pageSize) break;
    }
    hasMore = processed < page.size || page.size === limit;
    if (!hasMore || !last) break;
    query = query.startAfter(last);
  }
  const names = await currentActorNames(actor.organizationId, matches.map(doc => doc.get("actorUserId")));
  const time = last?.get("createdAt") as Timestamp | undefined;
  return {
    rows: matches.map(doc => projectActivity(doc.id, doc.data(), names[String(doc.get("actorUserId"))])),
    nextCursor: hasMore && last && time ? encodeActivityCursor({ v: 1, fingerprint, id: last.id, seconds: time.seconds, nanoseconds: time.nanoseconds }) : null,
    scanned, scanLimited: hasMore && scanned === 1000, fromDate: input.fromDate, toDate: input.toDate,
    note: "Recorded events only; not every click or read. Dates use Africa/Lagos. Current names are not historical identity evidence. Refresh to include newer events.",
  };
});

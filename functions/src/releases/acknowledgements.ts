import { FieldValue } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { db } from "../admin.js";
import type { AccessProfile } from "../auth/authorize.js";
import { uniquenessDocumentId } from "../inventory/calculations.js";
import { releaseNotes } from "./catalog.js";
import { parseInput } from "../utils/callable.js";
const schema = z.discriminatedUnion("action", [z.object({ action: z.literal("release_notes") }), z.object({ action: z.literal("acknowledge_release"), releaseId: z.string().max(100) })]);
export async function releaseAcknowledgements(actor: AccessProfile, data: unknown) {
  const input = parseInput(schema, data);
  const reference = (id: string) => db.doc(`userReleaseAcknowledgements/${uniquenessDocumentId(actor.organizationId, actor.userId, id)}`);
  if (input.action === "release_notes") {
    const rows = await db.getAll(...releaseNotes.map(release => reference(release.id)));
    return { releases: releaseNotes, acknowledgedReleaseIds: releaseNotes.filter((release,index) => rows[index]!.exists && rows[index]!.get("organizationId") === actor.organizationId && rows[index]!.get("userId") === actor.userId).map(release => release.id) };
  }
  if (!releaseNotes.some(release => release.id === input.releaseId)) throw new HttpsError("invalid-argument", "This release is not available.");
  await db.runTransaction(async tx => { const ref = reference(input.releaseId), current = await tx.get(ref); if (current.exists) { if (current.get("organizationId") !== actor.organizationId || current.get("userId") !== actor.userId) throw new HttpsError("permission-denied", "Release acknowledgement scope is inconsistent."); return; } tx.create(ref, { organizationId: actor.organizationId, userId: actor.userId, releaseId: input.releaseId, acknowledgedAt: FieldValue.serverTimestamp() }); });
  return { releaseId: input.releaseId, acknowledged: true };
}

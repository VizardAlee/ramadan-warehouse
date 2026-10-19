import { createHash } from "node:crypto";
import { HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { validActorUserId } from "./authority.js";
import { auditModule, auditReference } from "./activity-projection.js";

const short = z.string().trim().max(160).default("");
export const activityInput = z.object({
  fromDate: z.iso.date(), toDate: z.iso.date(), actorUserId: z.string().trim().max(128).refine(value => !value || validActorUserId(value), "Use a recorded actor ID, not a document path.").default(""),
  action: short, module: short, entityType: short, reference: short,
  pageSize: z.union([z.literal(25), z.literal(50), z.literal(100)]).default(25),
  cursor: z.string().max(1500).optional(),
}).superRefine((value, ctx) => {
  const days = (Date.parse(`${value.toDate}T00:00:00Z`) - Date.parse(`${value.fromDate}T00:00:00Z`)) / 86400000 + 1;
  if (value.fromDate < "0001-01-01" || value.toDate === "9999-12-31" || !Number.isFinite(days) || days < 1 || days > 366) ctx.addIssue({ code: "custom", path: ["toDate"], message: "Choose an ordered period of at most 366 days." });
});
export type ActivityInput = z.infer<typeof activityInput>;
export function activityBounds(input: Pick<ActivityInput, "fromDate" | "toDate">) {
  return { from: Date.parse(`${input.fromDate}T00:00:00+01:00`), until: Date.parse(`${input.toDate}T00:00:00+01:00`) + 86400000 };
}
export function activityFingerprint(scope: { userId: string; organizationId: string; authorizationVersion: number }, input: ActivityInput) {
  return createHash("sha256").update(JSON.stringify([scope.userId, scope.organizationId, scope.authorizationVersion,
    input.fromDate, input.toDate, input.actorUserId, input.action, input.module, input.entityType, input.reference, input.pageSize])).digest("hex");
}
export interface ActivityCursor { v: 1; fingerprint: string; id: string; seconds: number; nanoseconds: number }
export function encodeActivityCursor(cursor: ActivityCursor) { return Buffer.from(JSON.stringify(cursor)).toString("base64url"); }
export function decodeActivityCursor(value: string, fingerprint: string): ActivityCursor {
  try {
    const result = JSON.parse(Buffer.from(value, "base64url").toString());
    if (result.v !== 1 || result.fingerprint !== fingerprint || !/^[A-Za-z0-9_-]{1,128}$/.test(result.id) || !Number.isSafeInteger(result.seconds) || !Number.isInteger(result.nanoseconds) || result.nanoseconds < 0 || result.nanoseconds >= 1e9) throw new Error();
    return result;
  } catch { throw new HttpsError("invalid-argument", "Restart audit history after changing filters, account or access."); }
}
export function matchesActivity(record: Record<string, unknown>, input: ActivityInput) {
  return (!input.action || record.action === input.action) && (!input.module || auditModule(record.action) === input.module) &&
    (!input.entityType || record.entityType === input.entityType) && (!input.reference || (auditReference(record) ?? "").toLowerCase().includes(input.reference.toLowerCase()));
}

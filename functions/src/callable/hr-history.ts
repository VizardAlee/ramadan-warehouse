import { FieldPath, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";
import { db } from "../admin.js";
import { requireAccess, requirePermission } from "../auth/authorize.js";
import { enforceAppCheck } from "../config.js";
import { parseInput } from "../utils/callable.js";

export const hrHistoryInput = z.object({
  kind: z.enum(["attendance", "activity"]),
  fromDate: z.iso.date(), toDate: z.iso.date(),
  limit: z.union([z.literal(25), z.literal(50), z.literal(100)]).default(25),
  cursorId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional(),
}).refine(value => value.fromDate <= value.toDate, { message: "The end date cannot precede the start date.", path: ["toDate"] });

export function hrHistoryBounds(kind: "attendance" | "activity", fromDate: string, toDate: string) {
  if (kind === "activity") return { start: fromDate, end: toDate, endOperator: "<=" as const };
  const start = Timestamp.fromDate(new Date(`${fromDate}T00:00:00+01:00`));
  const end = Timestamp.fromMillis(Date.parse(`${toDate}T00:00:00+01:00`) + 86_400_000);
  return { start, end, endOperator: "<" as const };
}

export const getHrHistory = onCall({ enforceAppCheck }, async request => {
  const actor = await requireAccess(request); requirePermission(actor, "hr.read");
  const input = parseInput(hrHistoryInput, request.data);
  const collection = input.kind === "attendance" ? "attendanceEvents" : "employeeActivityEvents";
  const field = input.kind === "attendance" ? "occurredAt" : "occurredOn";
  const bounds = hrHistoryBounds(input.kind, input.fromDate, input.toDate);
  let query = db.collection(collection).where("organizationId", "==", actor.organizationId)
    .where(field, ">=", bounds.start).where(field, bounds.endOperator, bounds.end)
    .orderBy(field, "desc").orderBy(FieldPath.documentId(), "desc");
  if (input.cursorId) {
    const cursor = await db.doc(`${collection}/${input.cursorId}`).get();
    const value = cursor.get(field);
    const comparable = value instanceof Timestamp ? value.valueOf() : value;
    const start = bounds.start instanceof Timestamp ? bounds.start.valueOf() : bounds.start;
    const end = bounds.end instanceof Timestamp ? bounds.end.valueOf() : bounds.end;
    if (!cursor.exists || (input.kind === "attendance" ? !(value instanceof Timestamp) : typeof value !== "string") || cursor.get("organizationId") !== actor.organizationId || comparable < start || (bounds.endOperator === "<" ? comparable >= end : comparable > end))
      throw new HttpsError("invalid-argument", "This history cursor does not belong to the selected report.");
    query = query.startAfter(cursor);
  }
  const page = await query.limit(input.limit + 1).get(), docs = page.docs.slice(0, input.limit);
  const employeeIds = [...new Set(docs.map(doc => String(doc.get("employeeId") ?? "")).filter(id => /^[A-Za-z0-9_-]{1,128}$/.test(id)))];
  const employees = employeeIds.length ? await db.getAll(...employeeIds.map(id => db.doc(`employees/${id}`))) : [];
  const names = new Map(employees.filter(doc => doc.exists && doc.get("organizationId") === actor.organizationId).map(doc => [doc.id, { fullName: doc.get("fullName"), staffId: doc.get("staffId") }]));
  // Return report fields explicitly: salary and private employee/contact data never accompany history.
  const rows = docs.map(doc => ({ id: doc.id, employeeId: doc.get("employeeId"),
    staffId: doc.get("staffId") ?? names.get(doc.get("employeeId"))?.staffId ?? "Historical employee",
    employeeName: names.get(doc.get("employeeId"))?.fullName ?? "Historical employee",
    kind: doc.get("kind"), occurredAt: input.kind === "attendance" ? new Date((doc.get("occurredAt") as Timestamp).seconds * 1000 + Math.floor((doc.get("occurredAt") as Timestamp).nanoseconds / 1_000_000)).toISOString() : null,
    occurredOn: doc.get("occurredOn") ?? null, source: doc.get("source") ?? null,
    reason: doc.get("reason") ?? null, summary: doc.get("summary") ?? null,
  }));
  return { rows, nextCursorId: page.size > input.limit ? docs.at(-1)!.id : null };
});

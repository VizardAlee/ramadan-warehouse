import { createHash } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";
import { db } from "../admin.js";
import { hasServerPermission, requireAccess, requirePermission } from "../auth/authorize.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import { enforceAppCheck } from "../config.js";
import { correlationId, parseInput } from "../utils/callable.js";

const text = z.string().trim().min(1).max(160);
const optionalText = z.string().trim().max(160).nullable().optional();
const date = z.iso.date();
const employeeSchema = z.object({
  employeeId: z.string().min(1).max(128).optional(),
  staffId: z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9-]+$/),
  fullName: text,
  phone: optionalText,
  email: z.email().nullable().optional(),
  department: text,
  jobTitle: text,
  branchId: z.string().max(128).nullable().optional(),
  employmentDate: date,
  status: z.enum(["active", "on_leave", "inactive"]),
  userId: z.string().max(128).nullable().optional(),
  externalAttendanceId: z.string().trim().max(80).regex(/^[A-Za-z0-9_-]*$/).nullable().optional(),
});
const compensationSchema = z.object({
  employeeId: z.string().min(1).max(128),
  monthlySalaryMinor: z.number().int().nonnegative().safe(),
  effectiveFrom: date,
  reason: z.string().trim().min(3).max(500),
});
const attendanceSchema = z.object({
  employeeId: z.string().min(1).max(128),
  kind: z.enum(["clock_in", "clock_out"]),
  occurredAt: z.iso.datetime({ offset: true }),
  reason: z.string().trim().min(3).max(500),
  idempotencyKey: z.string().min(8).max(128),
});
const activitySchema = z.object({ employeeId: z.string().min(1).max(128), kind: z.enum(["leave", "training", "performance", "incident", "note"]), occurredOn: date, summary: z.string().trim().min(3).max(1000), idempotencyKey: z.string().min(8).max(128) });
const workspaceSchema = z.object({ limit: z.number().int().min(1).max(100).default(25), afterStaffId: z.string().min(1).max(40).optional() });
const codeId = (organizationId: string, code: string) => `${organizationId}_${encodeURIComponent(code.toUpperCase())}`;
const checkOccurredAt = (value: string) => {
  const time = Date.parse(value);
  if (!Number.isFinite(time) || time > Date.now() + 5 * 60_000 || time < Date.now() - 5 * 366 * 24 * 60 * 60_000)
    throw new HttpsError("invalid-argument", "Attendance time must be within the past five years and not in the future.");
  return Timestamp.fromMillis(time);
};

export const getHrWorkspace = onCall({ enforceAppCheck }, async (request) => {
  const actor = await requireAccess(request); requirePermission(actor, "hr.read");
  const input = parseInput(workspaceSchema, request.data ?? {});
  let employeeQuery = db.collection("employees").where("organizationId", "==", actor.organizationId).orderBy("staffId", "asc");
  if (input.afterStaffId) employeeQuery = employeeQuery.startAfter(input.afterStaffId);
  const [employees, attendance, activities] = await Promise.all([
    employeeQuery.limit(input.limit + 1).get(),
    db.collection("attendanceEvents").where("organizationId", "==", actor.organizationId).orderBy("occurredAt", "desc").limit(25).get(),
    db.collection("employeeActivityEvents").where("organizationId", "==", actor.organizationId).orderBy("occurredOn", "desc").limit(25).get(),
  ]);
  const page = employees.docs.slice(0, input.limit);
  const nextCursor = employees.docs.length > input.limit ? String(page.at(-1)?.get("staffId")) : null;
  const mayReadCompensation = hasServerPermission(actor, "hr.compensation.read");
  const compensation = mayReadCompensation
    ? await Promise.all(page.map((item) => db.doc(`employeeCompensation/${item.id}`).get()))
    : [];
  return {
    employees: page.map((item) => ({ id: item.id, ...item.data(), salary: mayReadCompensation ? compensation.find((entry) => entry.id === item.id)?.data() ?? null : undefined })),
    attendance: attendance.docs.map((item) => ({ id: item.id, ...item.data() })),
    activities: activities.docs.map((item) => ({ id: item.id, ...item.data() })),
    canViewCompensation: mayReadCompensation,
    nextCursor,
  };
});

export const saveEmployee = onCall({ enforceAppCheck }, async (request) => {
  const actor = await requireAccess(request); requirePermission(actor, "hr.manage");
  const input = parseInput(employeeSchema, request.data);
  const employeeRef = input.employeeId ? db.doc(`employees/${input.employeeId}`) : db.collection("employees").doc();
  const normalizedStaffId = input.staffId.toUpperCase();
  const staffRef = db.doc(`employeeStaffIds/${codeId(actor.organizationId, normalizedStaffId)}`);
  const external = input.externalAttendanceId || null;
  const externalRef = external ? db.doc(`employeeExternalIds/${codeId(actor.organizationId, external)}`) : null;
  const userRef = input.userId ? db.doc(`users/${input.userId}`) : null;
  const linkRef = input.userId ? db.doc(`employeeUserLinks/${input.userId}`) : null;
  if (input.branchId) {
    const branch = await db.doc(`branches/${input.branchId}`).get();
    if (!branch.exists || branch.get("organizationId") !== actor.organizationId || branch.get("status") === "inactive") throw new HttpsError("failed-precondition", "Store assignment is unavailable.");
  }
  if (userRef) {
    const user = await userRef.get();
    if (!user.exists || user.get("organizationId") !== actor.organizationId) throw new HttpsError("failed-precondition", "Linked app user must belong to this organization.");
  }
  await db.runTransaction(async (transaction) => {
    const [existing, staff, externalMapping, userLink] = await Promise.all([
      transaction.get(employeeRef), transaction.get(staffRef), externalRef ? transaction.get(externalRef) : Promise.resolve(null), linkRef ? transaction.get(linkRef) : Promise.resolve(null),
    ]);
    if (existing.exists && existing.get("organizationId") !== actor.organizationId) throw new HttpsError("permission-denied", "Employee is outside your organization.");
    if (existing.exists && existing.get("staffId") !== normalizedStaffId) throw new HttpsError("failed-precondition", "Staff ID cannot be changed after creation.");
    if (staff.exists && staff.get("employeeId") !== employeeRef.id) throw new HttpsError("already-exists", "Staff ID is already in use.");
    if (externalMapping?.exists && externalMapping.get("employeeId") !== employeeRef.id) throw new HttpsError("already-exists", "Fingerprint connector ID is already assigned.");
    if (userLink?.exists && userLink.get("employeeId") !== employeeRef.id) throw new HttpsError("already-exists", "App user is already linked to another employee.");
    const previousExternal = existing.get("externalAttendanceId") as string | null;
    const previousUserId = existing.get("userId") as string | null;
    if (previousExternal && previousExternal !== external) transaction.delete(db.doc(`employeeExternalIds/${codeId(actor.organizationId, previousExternal)}`));
    if (previousUserId && previousUserId !== input.userId) transaction.delete(db.doc(`employeeUserLinks/${previousUserId}`));
    if (!staff.exists) transaction.create(staffRef, { organizationId: actor.organizationId, employeeId: employeeRef.id });
    if (externalRef && !externalMapping?.exists) transaction.create(externalRef, { organizationId: actor.organizationId, employeeId: employeeRef.id });
    if (linkRef && !userLink?.exists) transaction.create(linkRef, { organizationId: actor.organizationId, employeeId: employeeRef.id });
    const now = FieldValue.serverTimestamp();
    transaction.set(employeeRef, {
      organizationId: actor.organizationId, staffId: normalizedStaffId, fullName: input.fullName,
      phone: input.phone || null, email: input.email || null, department: input.department,
      jobTitle: input.jobTitle, branchId: input.branchId || null, employmentDate: input.employmentDate,
      status: input.status, userId: input.userId || null, externalAttendanceId: external,
      updatedAt: now, updatedBy: actor.userId,
      ...(!existing.exists ? { createdAt: now, createdBy: actor.userId } : {}),
    }, { merge: true });
    writeAuditLog(transaction, actor, { action: existing.exists ? "employee.updated" : "employee.created", entityType: "employee", entityId: employeeRef.id, correlationId: correlationId(), sourceFunction: "saveEmployee", before: existing.exists ? { status: existing.get("status"), branchId: existing.get("branchId") } : undefined, after: { staffId: normalizedStaffId, status: input.status, branchId: input.branchId || null, userId: input.userId || null } });
  });
  return { employeeId: employeeRef.id };
});

export const saveEmployeeCompensation = onCall({ enforceAppCheck }, async (request) => {
  const actor = await requireAccess(request); requirePermission(actor, "hr.compensation.manage");
  const input = parseInput(compensationSchema, request.data);
  const employeeRef = db.doc(`employees/${input.employeeId}`);
  const currentRef = db.doc(`employeeCompensation/${input.employeeId}`);
  await db.runTransaction(async (transaction) => {
    const [employee, current] = await Promise.all([transaction.get(employeeRef), transaction.get(currentRef)]);
    if (!employee.exists || employee.get("organizationId") !== actor.organizationId) throw new HttpsError("not-found", "Employee not found.");
    const now = FieldValue.serverTimestamp();
    const versionRef = db.collection("employeeCompensationVersions").doc();
    transaction.create(versionRef, { organizationId: actor.organizationId, employeeId: input.employeeId, monthlySalaryMinor: input.monthlySalaryMinor, effectiveFrom: input.effectiveFrom, reason: input.reason, createdAt: now, createdBy: actor.userId, previousVersionId: current.get("versionId") ?? null });
    transaction.set(currentRef, { organizationId: actor.organizationId, employeeId: input.employeeId, monthlySalaryMinor: input.monthlySalaryMinor, effectiveFrom: input.effectiveFrom, versionId: versionRef.id, updatedAt: now });
    writeAuditLog(transaction, actor, { action: "employee.compensation_changed", entityType: "employee", entityId: input.employeeId, correlationId: correlationId(), sourceFunction: "saveEmployeeCompensation", reason: input.reason, before: current.exists ? { monthlySalaryMinor: current.get("monthlySalaryMinor"), effectiveFrom: current.get("effectiveFrom") } : undefined, after: { monthlySalaryMinor: input.monthlySalaryMinor, effectiveFrom: input.effectiveFrom, versionId: versionRef.id } });
  });
  return { updated: true };
});

export const recordAttendanceEvent = onCall({ enforceAppCheck }, async (request) => {
  const actor = await requireAccess(request); requirePermission(actor, "hr.attendance.manage");
  const input = parseInput(attendanceSchema, request.data);
  const occurredAt = checkOccurredAt(input.occurredAt);
  const employeeRef = db.doc(`employees/${input.employeeId}`);
  const eventRef = db.doc(`attendanceEvents/${actor.organizationId}_${input.idempotencyKey}`);
  await db.runTransaction(async (transaction) => {
    const [employee, existing] = await Promise.all([transaction.get(employeeRef), transaction.get(eventRef)]);
    if (!employee.exists || employee.get("organizationId") !== actor.organizationId) throw new HttpsError("not-found", "Employee not found.");
    if (existing.exists) return;
    transaction.create(eventRef, { organizationId: actor.organizationId, employeeId: input.employeeId, staffId: employee.get("staffId"), branchId: employee.get("branchId") ?? null, kind: input.kind, occurredAt, source: "manual", reason: input.reason, actorUserId: actor.userId, createdAt: FieldValue.serverTimestamp() });
    writeAuditLog(transaction, actor, { action: "attendance.recorded", entityType: "attendanceEvent", entityId: eventRef.id, correlationId: correlationId(), sourceFunction: "recordAttendanceEvent", reason: input.reason, after: { employeeId: input.employeeId, kind: input.kind, occurredAt: input.occurredAt, source: "manual" } });
  });
  return { eventId: eventRef.id };
});

export const recordEmployeeActivity = onCall({ enforceAppCheck }, async (request) => {
  const actor = await requireAccess(request); requirePermission(actor, "hr.manage");
  const input = parseInput(activitySchema, request.data);
  const ref = db.doc(`employeeActivityEvents/${actor.organizationId}_${input.idempotencyKey}`);
  await db.runTransaction(async (transaction) => {
    const [employee, existing] = await Promise.all([transaction.get(db.doc(`employees/${input.employeeId}`)), transaction.get(ref)]);
    if (!employee.exists || employee.get("organizationId") !== actor.organizationId) throw new HttpsError("not-found", "Employee not found.");
    if (existing.exists) return;
    transaction.create(ref, { organizationId: actor.organizationId, employeeId: input.employeeId, kind: input.kind, occurredOn: input.occurredOn, summary: input.summary, actorUserId: actor.userId, createdAt: FieldValue.serverTimestamp() });
    writeAuditLog(transaction, actor, { action: "employee.activity_recorded", entityType: "employeeActivityEvent", entityId: ref.id, correlationId: correlationId(), sourceFunction: "recordEmployeeActivity", after: { employeeId: input.employeeId, kind: input.kind, occurredOn: input.occurredOn } });
  });
  return { eventId: ref.id };
});

// A future device adapter calls this with a stable device event ID. No biometric
// image or template enters Firestore; only the device's employee code and time.
export async function ingestExternalAttendance(input: {
  organizationId: string; deviceId: string; externalEventId: string;
  externalAttendanceId: string; kind: "clock_in" | "clock_out"; occurredAt: string;
}): Promise<{ eventId: string; created: boolean }> {
  const parsed = z.object({ organizationId: z.string().min(1).max(128), deviceId: z.string().min(1).max(80), externalEventId: z.string().min(1).max(128), externalAttendanceId: z.string().min(1).max(80), kind: z.enum(["clock_in", "clock_out"]), occurredAt: z.iso.datetime({ offset: true }) }).parse(input);
  input = parsed;
  const occurredAt = checkOccurredAt(input.occurredAt);
  const mapping = await db.doc(`employeeExternalIds/${codeId(input.organizationId, input.externalAttendanceId)}`).get();
  if (!mapping.exists) throw new HttpsError("not-found", "Device employee ID is not mapped.");
  const employeeId = String(mapping.get("employeeId"));
  const eventId = `${input.organizationId}_${input.deviceId}_${input.externalEventId}`;
  const eventRef = db.doc(`attendanceEvents/${createSafeId(eventId)}`);
  let created = false;
  await db.runTransaction(async (transaction) => {
    const [employee, existing] = await Promise.all([transaction.get(db.doc(`employees/${employeeId}`)), transaction.get(eventRef)]);
    if (!employee.exists || employee.get("organizationId") !== input.organizationId || employee.get("status") === "inactive") throw new HttpsError("failed-precondition", "Mapped employee is inactive or unavailable.");
    if (existing.exists) return;
    transaction.create(eventRef, { organizationId: input.organizationId, employeeId, staffId: employee.get("staffId"), branchId: employee.get("branchId") ?? null, kind: input.kind, occurredAt, source: "fingerprint_connector", deviceId: input.deviceId, externalEventId: input.externalEventId, createdAt: FieldValue.serverTimestamp() });
    transaction.create(db.collection("auditLogs").doc(), { organizationId: input.organizationId, actorUserId: `connector:${input.deviceId}`, actorRoleId: "attendance_connector", action: "attendance.imported", entityType: "attendanceEvent", entityId: eventRef.id, correlationId: input.externalEventId, sourceFunction: "ingestExternalAttendance", after: { employeeId, kind: input.kind, deviceId: input.deviceId, occurredAt: input.occurredAt }, createdAt: FieldValue.serverTimestamp() });
    created = true;
  });
  return { eventId: eventRef.id, created };
}

function createSafeId(value: string): string { return createHash("sha256").update(value).digest("hex"); }

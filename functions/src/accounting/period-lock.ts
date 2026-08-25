import { Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import { uniquenessDocumentId } from "../inventory/calculations.js";

export function accountingPeriodKey(value: Timestamp | Date | string) {
  const date = value instanceof Timestamp ? value.toDate() : value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) throw new HttpsError("invalid-argument", "The accounting date is invalid.");
  return date.toISOString().slice(0, 7);
}

export function accountingPeriodReference(organizationId: string, value: Timestamp | Date | string) {
  const periodKey = accountingPeriodKey(value);
  return db.doc(`accountingPeriods/${uniquenessDocumentId(organizationId, periodKey)}`);
}

export function assertAccountingPeriodOpen(snapshot: DocumentSnapshot) {
  if (snapshot.exists && ["preparing", "prepared", "closed"].includes(String(snapshot.get("status"))))
    throw new HttpsError("failed-precondition", `Accounting period ${String(snapshot.get("periodKey"))} is ${String(snapshot.get("status"))}. Post the transaction in an open period.`, { code: "ACCOUNTING_PERIOD_LOCKED" });
}

export function accountingPeriodBounds(periodKey: string) {
  const start = new Date(`${periodKey}-01T00:00:00.000Z`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1) - 1);
  return { periodStart: start.toISOString().slice(0, 10), periodEnd: end.toISOString().slice(0, 10), start: Timestamp.fromDate(start), end: Timestamp.fromDate(end) };
}

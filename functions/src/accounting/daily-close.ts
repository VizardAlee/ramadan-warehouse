import { createHash } from "node:crypto";
import { FieldPath, Timestamp, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { db } from "../admin.js";

/** Nigerian business dates, not UTC dates: midnight in Kano is 23:00 UTC. */
export function dailyBounds(date: string) {
  const start = Timestamp.fromDate(new Date(`${date}T00:00:00.000+01:00`));
  const end = Timestamp.fromMillis(start.toMillis() + 86_400_000 - 1);
  return { start, end };
}
export function safeMinor(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value))
    throw new HttpsError("failed-precondition", "Reconcile invalid or oversized ledger amounts before closing this day.");
  return value;
}

/** All pages share the transaction snapshot. A later posting invalidates a prepared close. */
async function pages(transaction: Transaction, query: FirebaseFirestore.Query,
  visit: (document: FirebaseFirestore.QueryDocumentSnapshot) => void) {
  const ordered = query.orderBy(FieldPath.documentId());
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    const page = await transaction.get((cursor ? ordered.startAfter(cursor) : ordered).limit(400));
    for (const document of page.docs) visit(document);
    if (page.size < 400) return;
    cursor = page.docs.at(-1);
  }
}

export async function dailyEvidence(transaction: Transaction, organizationId: string, branchId: string, date: string) {
  const { start, end } = dailyBounds(date);
  const digest = createHash("sha256");
  const cash = { openingMinor: 0, receiptsMinor: 0, paymentsMinor: 0, closingMinor: 0, lineCount: 0 };
  // Include every source of posted cash, not just POS totals. No editable opening-balance field.
  await pages(transaction, db.collection("journalLines").where("organizationId", "==", organizationId)
    .where("branchId", "==", branchId).where("accountCode", "==", "1010"), (line) => {
    const effectiveAt = line.get("effectiveAt");
    if (!(effectiveAt instanceof Timestamp))
      throw new HttpsError("failed-precondition", "A cash posting is missing its accounting date.");
    if (effectiveAt.toMillis() > end.toMillis()) return;
    const debit = safeMinor(line.get("debitMinor") ?? 0), credit = safeMinor(line.get("creditMinor") ?? 0);
    if (debit < 0 || credit < 0) throw new HttpsError("failed-precondition", "A cash posting has a negative debit or credit.");
    digest.update(JSON.stringify([line.id, effectiveAt.toMillis(), debit, credit, line.get("journalEntryId") ?? null]));
    cash.lineCount += 1;
    if (effectiveAt.toMillis() < start.toMillis()) cash.openingMinor = safeMinor(cash.openingMinor + debit - credit);
    else {
      cash.receiptsMinor = safeMinor(cash.receiptsMinor + debit);
      cash.paymentsMinor = safeMinor(cash.paymentsMinor + credit);
    }
  });
  cash.closingMinor = safeMinor(cash.openingMinor + cash.receiptsMinor - cash.paymentsMinor);
  const stockCounts: Array<{ id: string; reference: string; status: string }> = [];
  await pages(transaction, db.collection("stockCounts").where("organizationId", "==", organizationId)
    .where("branchId", "==", branchId).where("countDate", "==", date), (count) => {
    if (stockCounts.length >= 500) throw new HttpsError("resource-exhausted", "Too many stock checks for one daily close. Contact an administrator.");
    stockCounts.push({ id: count.id, reference: String(count.get("countNumber") ?? count.id), status: String(count.get("status")) });
    digest.update(JSON.stringify([count.id, count.get("status"), count.updateTime.toMillis()]));
  });
  let openShiftCount = 0, closedShiftCount = 0, tillVarianceMinor = 0;
  await pages(transaction, db.collection("posShifts").where("organizationId", "==", organizationId)
    .where("branchId", "==", branchId), (shift) => {
    const openedAt = shift.get("openedAt"), closedAt = shift.get("closedAt");
    if (!(openedAt instanceof Timestamp) || openedAt.toMillis() > end.toMillis()) return;
    if (!(closedAt instanceof Timestamp) || closedAt.toMillis() > end.toMillis()) {
      openShiftCount += 1;
      digest.update(JSON.stringify([shift.id, "open", shift.updateTime.toMillis()]));
    } else if (closedAt.toMillis() >= start.toMillis()) {
      closedShiftCount += 1;
      tillVarianceMinor = safeMinor(tillVarianceMinor + safeMinor(shift.get("cashVarianceMinor") ?? 0));
      digest.update(JSON.stringify([shift.id, "closed", shift.updateTime.toMillis()]));
    }
  });
  const exceptions: string[] = [];
  if (!stockCounts.some((count) => count.status === "posted")) exceptions.push("No completed physical stock count is linked to this store and date.");
  if (stockCounts.some((count) => count.status !== "posted" && count.status !== "cancelled")) exceptions.push("Some stock counts are not complete.");
  if (openShiftCount) exceptions.push(`${openShiftCount} POS shift(s) were still open at the end of this day.`);
  if (tillVarianceMinor) exceptions.push("Closed POS shifts have a cash variance. Review the shift records.");
  const evidence = { cash, stockCounts, openShiftCount, closedShiftCount, tillVarianceMinor, exceptions };
  digest.update(JSON.stringify([organizationId, branchId, date, evidence]));
  return { ...evidence, hash: digest.digest("hex") };
}

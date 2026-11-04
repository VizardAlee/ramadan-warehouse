import { createHash } from "node:crypto";
import { HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { db } from "../admin.js";
import { hasServerPermission, type AccessProfile } from "../auth/authorize.js";
import { accountingPeriodReference, assertAccountingPeriodOpen } from "../accounting/period-lock.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import { internalTradeBalanceId } from "./identity.js";
import type { InternalTradeInvoiceLine } from "./model.js";

const id = z.string().trim().min(1).max(180).refine(value => !value.includes("/") && value !== "." && value !== "..");
export const internalTradeDamageReviewInput = z.object({
  action: z.literal("review_damage"), invoiceId: id, version: z.number().int().nonnegative(), idempotencyKey: z.string().uuid(),
  decision: z.enum(["charge", "no_charge"]), lines: z.array(z.object({ id, quantity: z.number().int().min(1).max(1_000_000) }).strict()).min(1).max(20),
  note: z.string().trim().min(3).max(1000),
}).strict();
export type InternalTradeDamageReviewInput = z.infer<typeof internalTradeDamageReviewInput>;
type DamageLine = InternalTradeInvoiceLine & { damagedQuantity?: number; pendingDamagedQuantity?: number; chargedDamagedQuantity?: number; waivedDamagedQuantity?: number };
export function canReviewInternalTradeDamage(actor: AccessProfile) {
  const direct = actor.directRoleIds ?? (actor.effectivePermissions ? [] : actor.roleIds ?? [actor.roleId]);
  return direct.some(role => role === "system_administrator" || role === "operations_administrator") && hasServerPermission(actor, "transfers.cost.create");
}
const fail = (message: string): never => { throw new HttpsError("failed-precondition", message); };
function safe(value: unknown, nonnegative = true): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || nonnegative && value < 0) fail("Internal trade damage-review evidence needs reconciliation.");
  return value as number;
}
/** Resolves only commercial liability. Damaged stock stays in quarantine. */
export async function reviewInternalTradeDamage(actor: AccessProfile, raw: InternalTradeDamageReviewInput) {
  if (!canReviewInternalTradeDamage(actor)) throw new HttpsError("permission-denied", "A directly assigned administrator with transfer pricing permission must review damage charges.");
  const input = internalTradeDamageReviewInput.parse(raw);
  if (new Set(input.lines.map(line => line.id)).size !== input.lines.length) throw new HttpsError("invalid-argument", "Combine duplicate damage-review lines.");
  const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const review = db.doc(`internalTradeDamageReviews/${actor.organizationId}_${input.idempotencyKey}`);
  const invoiceRef = db.doc(`internalTradeInvoices/${input.invoiceId}`);
  return db.runTransaction(async tx => {
    const [previous, invoice] = await tx.getAll(review, invoiceRef);
    if (!invoice!.exists || invoice!.get("organizationId") !== actor.organizationId) throw new HttpsError("not-found", "Internal invoice not found.");
    if (previous!.exists) {
      if (previous!.get("organizationId") !== actor.organizationId || previous!.get("actorUserId") !== actor.userId || previous!.get("fingerprint") !== fingerprint || previous!.get("invoiceId") !== input.invoiceId)
        throw new HttpsError("already-exists", "This damage-review reference belongs to another request.");
      return { invoiceId: input.invoiceId, reviewId: review.id, entryId: String(previous!.get("entryId")), amountMinor: safe(previous!.get("amountMinor")), repeated: true };
    }
    const version = safe(invoice!.get("version"));
    if (input.version < version) throw new HttpsError("failed-precondition", "This invoice changed. Refresh before reviewing damaged stock.", {code:"SAVED_ACTION_NOT_COMMITTED"});
    if (version !== input.version) fail("This invoice changed. Refresh before reviewing damaged stock.");
    const branchId = invoice!.get("branchId"), headOfficeBranchId = invoice!.get("headOfficeBranchId");
    if (typeof branchId !== "string" || !branchId || typeof headOfficeBranchId !== "string" || !headOfficeBranchId || branchId === headOfficeBranchId)
      fail("The internal invoice branch identities need reconciliation.");
    const balanceRef = db.doc(`internalTradeBalances/${internalTradeBalanceId(actor.organizationId, headOfficeBranchId, branchId)}`);
    const now = new Date().toISOString();
    const [balance, period] = await tx.getAll(balanceRef, accountingPeriodReference(actor.organizationId, now));
    if (input.decision === "charge") assertAccountingPeriodOpen(period!);
    if (!balance!.exists || balance!.get("organizationId") !== actor.organizationId || balance!.get("branchId") !== branchId || balance!.get("headOfficeBranchId") !== headOfficeBranchId)
      fail("The branch trading balance needs reconciliation.");
    const existingLines = invoice!.get("lines") as DamageLine[];
    if (!Array.isArray(existingLines) || new Set(existingLines.map(line => line.id)).size !== existingLines.length || input.lines.some(requested => !existingLines.some(line => line.id === requested.id)))
      fail("Choose damaged goods from this invoice's original lines.");
    const evidence: Array<{ id: string; productId: string; quantity: number; unitPriceMinor: number; reviewedValueMinor: number; amountMinor: number }> = [];
    let reviewedValueMinor = 0;
    const lines = existingLines.map(line => {
      const requested = input.lines.find(candidate => candidate.id === line.id);
      if (!requested) return line;
      const damaged = safe(line.damagedQuantity ?? 0), pending = safe(line.pendingDamagedQuantity ?? 0), charged = safe(line.chargedDamagedQuantity ?? 0), waived = safe(line.waivedDamagedQuantity ?? 0);
      if (pending + charged + waived !== damaged) fail("The damaged quantity history needs reconciliation.");
      if (requested.quantity > pending) fail("Review only damaged quantities still awaiting an administrator decision.");
      const unitPriceMinor = safe(line.unitPriceMinor), lineValue = safe(unitPriceMinor * requested.quantity);
      reviewedValueMinor = safe(reviewedValueMinor + lineValue);
      evidence.push({ id: line.id, productId: line.productId, quantity: requested.quantity, unitPriceMinor, reviewedValueMinor: lineValue, amountMinor: input.decision === "charge" ? lineValue : 0 });
      return { ...line, pendingDamagedQuantity: pending - requested.quantity, chargedDamagedQuantity: charged + (input.decision === "charge" ? requested.quantity : 0), waivedDamagedQuantity: waived + (input.decision === "no_charge" ? requested.quantity : 0) };
    });
    const amountMinor = input.decision === "charge" ? reviewedValueMinor : 0;
    const total = safe(invoice!.get("totalMinor")), paid = safe(invoice!.get("paidMinor")), returned = safe(invoice!.get("returnedMinor"));
    const aggregate = safe(balance!.get("invoicedMinor")), aggregatePaid = safe(balance!.get("paidMinor")), aggregateReturned = safe(balance!.get("returnedMinor"));
    if (safe(invoice!.get("balanceMinor"), false) !== total - paid - returned || returned > total || safe(balance!.get("balanceMinor"), false) !== aggregate - aggregatePaid - aggregateReturned || aggregateReturned > aggregate)
      fail("The internal invoice or branch balance needs reconciliation.");
    const nextVersion = safe(version + 1), entryId = `${input.invoiceId}_${String(nextVersion).padStart(12, "0")}`;
    const record = { organizationId: actor.organizationId, invoiceId: input.invoiceId, branchId, headOfficeBranchId,
      actorUserId: actor.userId, createdAt: now, effectiveAt: now, decision: input.decision, note: input.note,
      lines: evidence, amountMinor, reviewedValueMinor, signedAmountMinor: amountMinor, currency: "NGN", invoiceVersion: nextVersion,
      kind: input.decision === "charge" ? "damage_charge" : "damage_waiver", reviewId: review.id, entryId };
    tx.update(invoiceRef, { lines, totalMinor: safe(total + amountMinor), balanceMinor: safe(total + amountMinor - paid - returned, false), version: nextVersion, updatedAt: now });
    if (input.decision === "charge") tx.update(balanceRef, { invoicedMinor: safe(aggregate + amountMinor), balanceMinor: safe(aggregate + amountMinor - aggregatePaid - aggregateReturned, false), version: safe(safe(balance!.get("version")) + 1), updatedAt: now });
    tx.create(review, { ...record, fingerprint });
    tx.create(db.doc(`internalTradeEntries/${entryId}`), record);
    writeAuditLog(tx, actor, { action: `internal_trade.${record.kind}`, entityType: "internalTradeInvoice", entityId: input.invoiceId,
      correlationId: input.idempotencyKey, sourceFunction: "stockTransfers", reason: input.note,
      after: { reviewId: review.id, branchId, headOfficeBranchId, decision: input.decision, amountMinor, reviewedValueMinor, lines: evidence } });
    return { invoiceId: input.invoiceId, reviewId: review.id, entryId, amountMinor, repeated: false };
  });
}

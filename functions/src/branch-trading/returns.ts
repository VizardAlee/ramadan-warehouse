import { internalTradeBalanceId } from "./identity.js";
import { createHash } from "node:crypto";
import { FieldValue, type DocumentSnapshot } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { db } from "../admin.js";
import { hasServerPermission, type AccessProfile } from "../auth/authorize.js";
import { accountingPeriodReference, assertAccountingPeriodOpen } from "../accounting/period-lock.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import type { InternalTradeInvoiceLine as InvoiceLine } from "./model.js";
import { normalizeInventoryIdentifier, uniquenessDocumentId } from "../inventory/calculations.js";
import { postInventoryTransactionGroup, type PostingRequest } from "../inventory/post-inventory-transaction.js";

const id = z.string().trim().min(1).max(180).refine(value => !value.includes("/") && value !== "." && value !== "..");
export const internalTradeReturnInput = z.object({
  action: z.literal("return_goods"),
  confirmedReceived: z.literal(true),
  confirmedResellable: z.literal(true),
  invoiceId: id,
  lines: z.array(z.object({ id, quantity: z.number().int().min(1).max(1_000_000), serialItemIds: z.array(id).max(50).default([]) })).min(1).max(10),
  note: z.string().trim().min(3).max(1000),
  idempotencyKey: z.string().uuid(),
}).strict();
export type InternalTradeReturnInput = z.infer<typeof internalTradeReturnInput>;

function fail(message: string): never { throw new HttpsError("failed-precondition", message); }
const integer = (value: unknown, nonnegative = true): number => {
  if (!Number.isSafeInteger(value) || (nonnegative && Number(value) < 0)) fail("Internal trading balances need administrator review.");
  return Number(value);
};
export function canReturnInternalTradeGoods(actor: AccessProfile) {
  const direct = actor.directRoleIds ?? (actor.effectivePermissions ? [] : actor.roleIds ?? [actor.roleId]);
  return direct.some(role => role === "system_administrator" || role === "operations_administrator") && hasServerPermission(actor, "inventory.move_internal");
}
function requireAdmin(actor: AccessProfile) {
  if (!canReturnInternalTradeGoods(actor))
    throw new HttpsError("permission-denied", "Only a directly assigned administrator can confirm returned internal stock.");
}
function requireInvoice(snapshot: DocumentSnapshot, actor: AccessProfile) {
  if (!snapshot.exists || snapshot.get("organizationId") !== actor.organizationId)
    throw new HttpsError("not-found", "Internal invoice not found.");
  if (!snapshot.get("branchId") || !snapshot.get("headOfficeBranchId") || !snapshot.get("sourceLocationId") || !snapshot.get("destinationLocationId"))
    fail("The internal invoice has incomplete original stock evidence.");
}
function invoiceLines(snapshot: DocumentSnapshot): InvoiceLine[] {
  const lines = snapshot.get("lines") as InvoiceLine[];
  if (!Array.isArray(lines) || !lines.length || new Set(lines.map(line => line.id)).size !== lines.length)
    fail("The internal invoice lines need administrator review.");
  return lines;
}
/** A return is confirmation of goods physically back at their original HQ stock area. */
export async function returnInternalTradeGoods(actor: AccessProfile, raw: InternalTradeReturnInput) {
  requireAdmin(actor);
  const input = internalTradeReturnInput.parse(raw);
  if (new Set(input.lines.map(line => line.id)).size !== input.lines.length)
    throw new HttpsError("invalid-argument", "Combine duplicate return lines.");
  const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const invoiceRef = db.doc(`internalTradeInvoices/${input.invoiceId}`);
  const returnRef = db.doc(`internalTradeReturns/${actor.organizationId}_${input.idempotencyKey}`);
  const [initial, previous] = await db.getAll(invoiceRef, returnRef);
  requireInvoice(initial!, actor);
  const replay = (record: DocumentSnapshot) => {
    if (record.get("organizationId") !== actor.organizationId || record.get("actorUserId") !== actor.userId || record.get("fingerprint") !== fingerprint || record.get("invoiceId") !== input.invoiceId)
      throw new HttpsError("already-exists", "This return retry reference belongs to another request.");
    return { returnId: returnRef.id, invoiceId: input.invoiceId, amountMinor: record.get("amountMinor") as number, posted: false, inventoryTransactionIds: record.get("inventoryTransactionIds") as string[] };
  };
  if (previous!.exists) return replay(previous!);
  const originals = invoiceLines(initial!);
  const selected = input.lines.map(requested => {
    const original = originals.find(line => line.id === requested.id);
    if (!original) fail("Choose a line from the original internal invoice.");
    return { original, requested };
  });
  if (new Set(selected.map(({ original }) => original.productId)).size !== selected.length)
    throw new HttpsError("invalid-argument", "Return different lots of the same product in separate documents.");
  const serialIds = input.lines.flatMap(line => line.serialItemIds);
  if (serialIds.length > 50 || new Set(serialIds).size !== serialIds.length)
    throw new HttpsError("invalid-argument", "Choose at most 50 distinct serials per return.");
  const serialSnapshots = serialIds.length ? await db.getAll(...serialIds.map(serialId => db.doc(`serializedItems/${serialId}`))) : [];
  const serialMap = new Map(serialSnapshots.map(snapshot => [snapshot.id, snapshot]));
  const effectiveAt = new Date().toISOString();
  const sourceLocationId = String(initial!.get("destinationLocationId"));
  const destinationLocationId = String(initial!.get("sourceLocationId"));
  const branchId = String(initial!.get("branchId"));
  const headOfficeBranchId = String(initial!.get("headOfficeBranchId"));
  const balanceRef = db.doc(`internalTradeBalances/${internalTradeBalanceId(actor.organizationId,headOfficeBranchId,branchId)}`);
  const postingKey = `internalTradeReturn_${input.idempotencyKey}`;
  const postings: PostingRequest[] = selected.map(({ original, requested }, index) => ({
    transactionType: "transfer_receipt", preserveInternalTransferValue: true, productId: original.productId, quantity: requested.quantity,
    sourceLocationId, destinationLocationId, lotId: original.lotId,
    serialNumbers: requested.serialItemIds.map(serialId => {
      const serial = serialMap.get(serialId);
      if (!serial?.exists || serial.get("organizationId") !== actor.organizationId || serial.get("productId") !== original.productId || !serial.get("serialNumber") || serial.id !== uniquenessDocumentId(actor.organizationId, normalizeInventoryIdentifier(String(serial.get("serialNumber")))))
        fail("A selected serial does not belong to this original invoice product.");
      return String(serial.get("serialNumber"));
    }),
    effectiveAt, reason: input.note, referenceType: "internalTradeInvoice", referenceId: input.invoiceId,
    referenceNumber: String(initial!.get("number") ?? input.invoiceId),
    idempotencyKey: `${postingKey}_${index}`, correlationId: input.idempotencyKey,
    sourceFunction: "stockTransfers.return_goods", requestFingerprint: fingerprint,
    transferContext: { transferId: input.invoiceId },
  }));
  const result = await postInventoryTransactionGroup(actor, { idempotencyKey: postingKey, requestFingerprint: fingerprint }, postings, {
    async prepare(reader) {
      const [invoice, balance, period, existing, source, destination, ...serials] = await reader.getAll(
        invoiceRef, balanceRef, accountingPeriodReference(actor.organizationId, effectiveAt), returnRef,
        db.doc(`inventoryLocations/${sourceLocationId}`), db.doc(`inventoryLocations/${destinationLocationId}`),
        ...serialIds.map(serialId => db.doc(`serializedItems/${serialId}`)),
      );
      requireInvoice(invoice!, actor);
      assertAccountingPeriodOpen(period!);
      if (existing!.exists) fail("This return was already posted. Retry to retrieve its original result.");
      if (invoice!.get("branchId") !== branchId || invoice!.get("headOfficeBranchId") !== headOfficeBranchId || invoice!.get("sourceLocationId") !== destinationLocationId || invoice!.get("destinationLocationId") !== sourceLocationId)
        fail("The original internal invoice location evidence changed.");
      if (!balance!.exists || balance!.get("organizationId") !== actor.organizationId || balance!.get("branchId") !== branchId || balance!.get("headOfficeBranchId") !== headOfficeBranchId)
        fail("The branch's internal balance needs administrator review.");
      if (!source!.exists || source!.get("organizationId") !== actor.organizationId || source!.get("branchId") !== branchId || source!.get("type") !== "branch" || !destination!.exists || destination!.get("organizationId") !== actor.organizationId)
        fail("The original branch and HQ locations are no longer valid.");
      const currentSerials = new Map(serials.map(serial => [serial.id, serial]));
      let amountMinor = 0;
      const currentLines = invoiceLines(invoice!);
      if (selected.some(({ requested }) => !currentLines.some(line => line.id === requested.id)))
        fail("An original invoice line is missing. Reconcile its evidence before returning stock.");
      const lines = currentLines.map(line => {
        const selection = selected.find(candidate => candidate.requested.id === line.id);
        if (!selection) return line;
        const { original, requested } = selection;
        if (line.productId !== original.productId || line.lotId !== original.lotId || line.trackingType !== original.trackingType || line.unitPriceMinor !== original.unitPriceMinor)
          fail("The original invoice product or price changed. Refresh before returning stock.");
        const received = integer(line.receivedQuantity), returned = integer(line.returnedQuantity ?? 0), unitPrice = integer(line.unitPriceMinor);
        if (requested.quantity > received - returned) fail("Return quantity exceeds the invoiced stock not already returned.");
        const returnedIds = line.returnedSerialItemIds ?? [];
        if (line.trackingType === "serial") {
          if (requested.serialItemIds.length !== requested.quantity || requested.serialItemIds.some(serialId => !(line.serialItemIds ?? []).includes(serialId) || returnedIds.includes(serialId)))
            fail("Return only the original invoiced serials, once each.");
          for (const serialId of requested.serialItemIds) {
            const serial = currentSerials.get(serialId)!;
            if (!serial.exists || serial.get("serialNumber") !== serialMap.get(serialId)!.get("serialNumber") || serial.get("organizationId") !== actor.organizationId || serial.get("productId") !== line.productId || serial.get("currentLocationId") !== sourceLocationId || !["available", "at_branch"].includes(String(serial.get("status"))) || serial.get("reservedTransferId") || serial.get("reservedSaleId") || serial.get("active") === false)
              fail("A returned serial is not available in the original receiving branch.");
          }
        } else if (requested.serialItemIds.length) fail("This return product does not use serial numbers.");
        amountMinor = integer(amountMinor + integer(unitPrice * requested.quantity));
        return { ...line, returnedQuantity: returned + requested.quantity, returnedSerialItemIds: [...returnedIds, ...requested.serialItemIds] };
      });
      const total = integer(invoice!.get("totalMinor")), paid = integer(invoice!.get("paidMinor")), returned = integer(invoice!.get("returnedMinor"));
      if (integer(invoice!.get("balanceMinor"), false) !== total - paid - returned || returned + amountMinor > total)
        fail("The invoice balance needs administrator review.");
      const balanceInvoiced = integer(balance!.get("invoicedMinor")), balancePaid = integer(balance!.get("paidMinor")), balanceReturned = integer(balance!.get("returnedMinor"));
      if (integer(balance!.get("balanceMinor"), false) !== balanceInvoiced - balancePaid - balanceReturned)
        fail("The branch balance needs administrator review.");
      return { lines, amountMinor, invoiceReturned: integer(returned + amountMinor), invoiceBalance: integer(total - paid - returned - amountMinor, false), invoiceVersion: integer(invoice!.get("version")), balanceReturned: integer(balanceReturned + amountMinor), balanceBalance: integer(balanceInvoiced - balancePaid - balanceReturned - amountMinor, false), balanceVersion: integer(balance!.get("version")) };
    },
    apply(writer, state, movements) {
      const now = FieldValue.serverTimestamp();
      writer.update(invoiceRef, { lines: state.lines, returnedMinor: state.invoiceReturned, balanceMinor: state.invoiceBalance, version: state.invoiceVersion + 1, updatedAt: now });
      writer.update(balanceRef, { returnedMinor: state.balanceReturned, balanceMinor: state.balanceBalance, version: state.balanceVersion + 1, updatedAt: now });
      const entry = { organizationId: actor.organizationId, invoiceId: input.invoiceId, branchId, headOfficeBranchId,
        confirmedReceived: true, confirmedResellable:true, amountMinor: state.amountMinor, actorUserId: actor.userId, createdAt: now, effectiveAt, currency: "NGN", returnId: returnRef.id,
        inventoryTransactionIds: movements.map(movement => movement.transactionId) };
      writer.create(returnRef, { ...entry, lines: input.lines, note: input.note, fingerprint, status: "posted" });
      writer.create(db.collection("internalTradeEntries").doc(`${input.invoiceId}_${String(state.invoiceVersion+1).padStart(12,"0")}`), { ...entry, kind: "return", signedAmountMinor: -state.amountMinor });
      writeAuditLog(writer, actor, { action: "internal_trade.goods_returned", entityType: "internalTradeInvoice", entityId: input.invoiceId,
        correlationId: input.idempotencyKey, sourceFunction: "stockTransfers", reason: input.note,
        after: { returnId: returnRef.id, branchId, amountMinor: state.amountMinor, inventoryTransactionIds: entry.inventoryTransactionIds } });
      return undefined;
    },
  });
  const posted = await returnRef.get();
  if (!posted.exists) fail("Return evidence was not found after stock posting. Contact an administrator before trying again.");
  return { ...replay(posted), posted: result.posted };
}

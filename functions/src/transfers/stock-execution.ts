import { createHash } from "node:crypto";
import { FieldValue, type DocumentSnapshot, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import type { AccessProfile } from "../auth/authorize.js";
import { postInventoryTransaction, type PostingRequest } from "../inventory/post-inventory-transaction.js";

export type ExecutionKind = "dispatch" | "receipt";
export interface StockExecution {
  id: string;
  organizationId: string;
  transferId: string;
  entityId: string;
  kind: ExecutionKind;
  identity: string;
  confirmationFingerprint: string;
  status: "posting" | "completed";
  movements: PostingRequest[];
  progress: Record<string, string>;
  details: Record<string, unknown>;
  transferState: string;
}
type Reader = Pick<Transaction, "get" | "getAll">;
export const executionRef = (kind: ExecutionKind, entityId: string) =>
  db.doc(`transferStockExecutions/${kind}_${createHash("sha256").update(entityId).digest("hex")}`);
export function stockReview(message: string): never {
  throw new HttpsError("failed-precondition", `${message} Ask the responsible manager to review the original transfer evidence; no historical stock repair was attempted.`, { code: "TRANSFER_STOCK_REVIEW_REQUIRED" });
}
export function assertNoStockExecution(transfer: DocumentSnapshot, allowedId?: string) {
  const active = transfer.get("activeStockExecutionId");
  if (active && active !== allowedId)
    throw new HttpsError("failed-precondition", `Stock confirmation is unfinished. Resume ${String(transfer.get("activeStockExecutionKind"))} ${String(transfer.get("activeStockExecutionEntityId"))} with its original quantities before changing this transfer.`, { code: "TRANSFER_STOCK_EXECUTION_PENDING" });
}
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : value;
export const executionIdentity = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
export function stockMovementChunks(quantity: number, serialNumbers: string[]) {
  if (!serialNumbers.length) return [{ quantity, serialNumbers }];
  const chunks = [];
  for (let offset = 0; offset < serialNumbers.length; offset += 50) {
    const selected = serialNumbers.slice(offset, offset + 50);
    chunks.push({ quantity: selected.length, serialNumbers: selected });
  }
  return chunks;
}
const transferState = (transfer: DocumentSnapshot) => executionIdentity(Object.fromEntries([
  "version", "status", "originWarehouseId", "originLocationId", "destinationBranchId", "destinationLocationId", "transitLocationId", "damagedLocationId",
  "totalApprovedQuantity", "totalReservedQuantity", "totalDispatchedQuantity", "totalReceivedQuantity", "totalDamagedQuantity", "totalMissingQuantity", "totalReturnedQuantity", "totalWrittenOffQuantity", "cancelledRemainingQuantity",
].map(field => [field, transfer.get(field)])));

/** Freeze a prospective execution before any movement. Existing untracked stock
 * postings are review-only: replaying an old half-finished command is not repair. */
export async function startStockExecution(
  actor: AccessProfile,
  input: { kind: ExecutionKind; transferId: string; entityId: string; expectedVersion: number; identity: unknown; confirmationInput: Record<string, unknown> },
  build: (reader: Reader, transfer: DocumentSnapshot, entity: DocumentSnapshot) => Promise<{ movements: PostingRequest[]; details: Record<string, unknown> }>,
): Promise<StockExecution> {
  const ref = executionRef(input.kind, input.entityId);
  const identity = executionIdentity(input.identity);
  const confirmationFingerprint = executionIdentity(input.confirmationInput);
  return db.runTransaction(async tx => {
    const [previous, transfer, entity] = await tx.getAll(ref, db.doc(`transfers/${input.transferId}`), db.doc(`${input.kind === "dispatch" ? "transferDispatches" : "transferReceipts"}/${input.entityId}`));
    if (previous!.exists) {
      const plan = previous!.data() as StockExecution;
      if (plan.transferId !== input.transferId || plan.organizationId !== actor.organizationId || plan.identity !== identity || plan.confirmationFingerprint !== confirmationFingerprint)
        stockReview("This confirmation already has frozen stock instructions. Resume the original document and quantities.");
      return { ...plan, id: ref.id };
    }
    assertNoStockExecution(transfer!);
    if (!transfer!.exists || transfer!.get("organizationId") !== actor.organizationId || !entity!.exists || entity!.get("transferId") !== transfer!.id || entity!.get("status") !== "draft" || Number(transfer!.get("version")) !== input.expectedVersion)
      throw new HttpsError("failed-precondition", "The transfer version or confirmation stage changed. Refresh before continuing.");
    const priorMovements = await tx.get(db.collection("inventoryTransactions").where("referenceId", "==", input.entityId));
    if (priorMovements.docs.some(doc => doc.get("organizationId") === actor.organizationId))
      stockReview("This legacy confirmation already has stock postings without a recoverable execution plan.");
    const discrepancies = await tx.get(db.collection("transferDiscrepancies").where("transferId", "==", input.transferId));
    if (discrepancies.docs.some(doc => doc.get("resolutionInProgress") === true || (doc.get("resolutionIdempotencyKey") && !["resolved", "closed"].includes(String(doc.get("status"))))))
      stockReview("A discrepancy resolution is unfinished. Resume that original resolution before confirming more stock.");
    const built = await build(tx, transfer!, entity!);
    const effectiveAt = new Date().toISOString();
    const plan: StockExecution = { id: ref.id, organizationId: actor.organizationId, transferId: transfer!.id, entityId: entity!.id, kind: input.kind, identity, confirmationFingerprint, status: "posting", progress: {}, details: built.details, transferState: transferState(transfer!),
      movements: built.movements.map((movement, index) => ({ ...movement, effectiveAt, idempotencyKey: `transfer_${ref.id}_${index}`, requestFingerprint: identity })) };
    if (Buffer.byteLength(JSON.stringify(plan)) > 700_000)
      stockReview("This confirmation is too large for a safe recoverable plan. Split the dispatch or receipt before posting.");
    tx.create(ref, JSON.parse(JSON.stringify(plan)));
    tx.update(transfer!.ref, { activeStockExecutionId: ref.id, activeStockExecutionKind: input.kind, activeStockExecutionEntityId: input.entityId, activeStockExecutionInput: JSON.parse(JSON.stringify(input.confirmationInput)) });
    return plan;
  });
}

/** Each progress marker commits with its inventory movement. A crash between
 * movements leaves an explicit lock, not a falsely confirmed dispatch/receipt. */
export async function postStockExecution(actor: AccessProfile, plan: StockExecution) {
  const ref = executionRef(plan.kind, plan.entityId);
  for (const [index, movement] of plan.movements.entries()) {
    if ((await ref.get()).get("progress")?.[String(index)]) continue;
    await postInventoryTransaction(actor, movement, {
      async prepare(reader) {
        const [current, transfer] = await reader.getAll(ref, db.doc(`transfers/${plan.transferId}`));
        if (current!.get("status") !== "posting" || transfer!.get("activeStockExecutionId") !== ref.id || transferState(transfer!) !== plan.transferState)
          stockReview("The stock execution lock changed before the movement could commit.");
        return (current!.get("progress") ?? {}) as Record<string, string>;
      },
      apply(writer, progress, context) {
        writer.update(ref, { progress: { ...progress, [String(index)]: context.transactionId }, updatedAt: FieldValue.serverTimestamp() });
        return undefined;
      },
    });
  }
  const snapshot = await ref.get();
  return plan.movements.map((_, index) => {
    const id = snapshot.get("progress")?.[String(index)];
    if (typeof id !== "string") stockReview("A stock posting lacks its atomic execution-progress marker.");
    return id as string;
  });
}

export async function prepareStockExecutionFinish(reader: Reader, plan: StockExecution) {
  const ref = executionRef(plan.kind, plan.entityId);
  const [current, transfer] = await reader.getAll(ref, db.doc(`transfers/${plan.transferId}`));
  if (current!.get("status") === "completed") return null;
  if (transfer!.get("activeStockExecutionId") !== ref.id || transferState(transfer!) !== plan.transferState || plan.movements.some((_, index) => !current!.get("progress")?.[String(index)]))
    stockReview("Stock execution is incomplete. Resume its original confirmation.");
  return (writer: Pick<Transaction, "update">) => {
    writer.update(ref, { status: "completed", completedAt: FieldValue.serverTimestamp() });
    writer.update(transfer!.ref, { activeStockExecutionId: FieldValue.delete(), activeStockExecutionKind: FieldValue.delete(), activeStockExecutionEntityId: FieldValue.delete(), activeStockExecutionInput: FieldValue.delete() });
  };
}

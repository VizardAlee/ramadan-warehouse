import { createHash } from "node:crypto";
import { FieldValue, type DocumentSnapshot, type Transaction } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import type { z } from "zod";
import { db } from "../admin.js";
import { enforceAppCheck } from "../config.js";
import { requireAccess, requirePermission, hasServerPermission, permissionsForServerRole, type AccessProfile, type Permission, type RoleId } from "../auth/authorize.js";
import { loadCustomRoles } from "../auth/custom-roles.js";
import { parseInput } from "../utils/callable.js";
import { narrowTransferWorkingContext, type TransferActionSide } from "./working-context.js";

type Row = Record<string, unknown>;
type ActionAccess = AccessProfile & { organizationActions: readonly Permission[] };
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, field]) => [key, canonical(field)])) : value;
export const transferCommandFingerprint = (action: string, input: Row) => createHash("sha256").update(JSON.stringify(canonical({ action, input: Object.fromEntries(Object.entries(input).filter(([key]) => key !== "idempotencyKey")) }))).digest("hex");
export const transferCommandRef = (organizationId: string, key: string) => db.doc(`idempotencyKeys/${organizationId}_transferCommand_${key}`);
const reviewRetry = (): never => { throw new HttpsError("failed-precondition", "This older transfer retry lacks verified actor and payload binding. Review the original record before continuing; do not change the key to repair historical stock.", { code: "TRANSFER_RETRY_REVIEW_REQUIRED" }); };

async function actionAccess(actor: AccessProfile): Promise<ActionAccess> {
  const direct = actor.directRoleIds ?? (actor.effectivePermissions ? [] : actor.roleIds ?? [actor.roleId]);
  const financeActions = (role: RoleId, permission: Permission) => role === "finance_officer" && permission.startsWith("transfers.cost.");
  const organizationActions = direct.flatMap(role => permissionsForServerRole(role).filter(permission => role === "system_administrator" || role === "operations_administrator" || financeActions(role, permission)));
  const custom = actor.customRoleIds?.length ? await loadCustomRoles(actor.organizationId, actor.customRoleIds) : [];
  organizationActions.push(...custom.flatMap(role => role.permissionIds.filter(permission => role.baseRoleId === "operations_administrator" || financeActions(role.baseRoleId, permission))));
  return { ...actor, organizationActions };
}

/** Read permissions and unrelated broad role bases never promote an action.
 * Existing explicit organization action grants retain their provenance. */
export function requireTransferActionScope(actor: ActionAccess, transfer: DocumentSnapshot, permission: Permission, side: Exclude<TransferActionSide, "catalog">) {
  if (!transfer.exists || transfer.get("organizationId") !== actor.organizationId) throw new HttpsError("not-found", "Transfer not found.");
  requirePermission(actor, permission);
  const warehouseId = transfer.get("originWarehouseId");
  const branchId = transfer.get("destinationBranchId");
  const source = typeof warehouseId === "string" && actor.warehouseIds.includes(warehouseId);
  const destination = typeof branchId === "string" && actor.branchIds.includes(branchId);
  if (!(hasServerPermission(actor, "transfers.read.all")
    || (hasServerPermission(actor, "transfers.read.assigned_warehouse") && source)
    || (hasServerPermission(actor, "transfers.read.own_branch") && destination)))
    throw new HttpsError("permission-denied", "The transfer is outside your current reading authority.");
  if (actor.organizationActions.includes(permission)) return;
  if (!(side === "source" ? source : side === "destination" ? destination : source || destination))
    throw new HttpsError("permission-denied", "This transfer action is outside your authorized source or destination location.");
}

const relationCollections: Record<string, string> = { packageId: "transferPackages", dispatchId: "transferDispatches", receiptId: "transferReceipts", pickId: "transferPicks", discrepancyId: "transferDiscrepancies", costId: "transferCosts" };
const legacyActions: Record<string, string> = { createAdminTransfer: "createTransfer", createTransferFromRequest: "createTransfer", reserveTransferStock: "reserveTransfer", releaseTransferReservation: "releaseTransfer", recordActualTransferCost: "actualTransferCost", reconcileTransferCosts: "reconcileTransferCost" };
const oldAction = (action: string) => legacyActions[action] ?? action;
const entityIdentity = (input: Row) => JSON.stringify(canonical(Object.fromEntries(["transferId", "packageId", "dispatchId", "receiptId", "pickId", "discrepancyId", "costId", "id", "resourceType", "originWarehouseId", "originLocationId", "destinationBranchId", "destinationLocationId"].map(field => [field, input[field]]))));
const resourceCollection = (input: Row) => input.resourceType === "vehicle" ? "vehicles" : input.resourceType === "driver" ? "drivers" : "logisticsVendors";

/** The command binding was committed before business execution. A completed
 * operation under that same bound key is sufficient recovery evidence even if
 * the response-cache transaction was interrupted and the workflow advanced. */
async function recoverCommittedResult(tx: Transaction, actor: ActionAccess, action: string, input: Row, key: string): Promise<Row | null> {
  const recordedAction = ({ cancelTransfer: "cancelTransfer", reserveTransferStock: "reserveTransfer", releaseTransferReservation: "releaseTransferReservation" } as Record<string, string>)[action];
  if (!recordedAction) return null;
  const operation = await tx.get(db.doc(`idempotencyKeys/${actor.organizationId}_${oldAction(action)}_${key}`));
  if (!operation.exists) return null;
  if (operation.get("organizationId") !== actor.organizationId || operation.get("createdBy") !== actor.userId || operation.get("action") !== recordedAction || operation.get("entityId") !== input.transferId || operation.get("status") !== "completed") reviewRetry();
  const result = operation.get("result");
  if (result !== undefined) {
    if (!result || typeof result !== "object" || Array.isArray(result) || (result.transferId !== undefined && result.transferId !== input.transferId)) reviewRetry();
    return result as Row;
  }
  // Compatibility only for a verified pending security-version-1 binding.
  // Older operation rows omit response details; do not invent quantities.
  return action === "cancelTransfer" ? { cancelled: false, remainingCancelled: false }
    : { transferId: input.transferId, [action === "reserveTransferStock" ? "reserved" : "released"]: false };
}

async function authorizeCommand(tx: Transaction, actor: ActionAccess, action: string, input: Row, permission: Permission, side: TransferActionSide, previous: DocumentSnapshot) {
  requirePermission(actor, permission);
  if (side === "catalog") {
    if (!actor.organizationActions.includes(permission) && !actor.warehouseIds.length)
      throw new HttpsError("permission-denied", "Choose an authorized source warehouse before maintaining logistics resources.");
    const id = input.id ?? previous.get("result")?.id;
    if (typeof id === "string") {
      const existing = await tx.get(db.doc(`${resourceCollection(input)}/${id}`));
      if (existing.exists && existing.get("organizationId") !== actor.organizationId) throw new HttpsError("not-found", "Logistics resource not found.");
    }
    return;
  }
  if (typeof input.transferId === "string") {
    const transfer = await tx.get(db.doc(`transfers/${input.transferId}`));
    requireTransferActionScope(actor, transfer, permission, side);
    for (const [field, collection] of Object.entries(relationCollections)) {
      const resultId = previous.get("result")?.[field];
      const ids = [...new Set([input[field], resultId].filter((id): id is string => typeof id === "string"))];
      for (const id of ids) {
        const child = await tx.get(db.doc(`${collection}/${id}`));
        // Optional creation references may not exist yet. Returned result IDs
        // must still exist and belong to the original transfer on replay.
        const optionalCreation = id !== resultId && ((action === "createTransferPackage" && field === "packageId") || (action === "createTransferCost" && field === "costId"));
        if ((!child.exists && !optionalCreation) || (child.exists && (child.get("organizationId") !== actor.organizationId || child.get("transferId") !== transfer.id)))
          throw new HttpsError("not-found", "The referenced record does not belong to this transfer.");
        if (field === "receiptId" && input.dispatchId && child.exists && child.get("dispatchId") !== input.dispatchId)
          throw new HttpsError("not-found", "Receipt does not belong to the selected dispatch.");
      }
    }
    return;
  }
  // Creation remains source-scoped; discovering or receiving at a branch does
  // not confer authority over an unrelated sending warehouse.
  const source = await tx.get(db.doc(`inventoryLocations/${input.originLocationId}`));
  if (!source.exists || source.get("organizationId") !== actor.organizationId || source.get("warehouseId") !== input.originWarehouseId)
    throw new HttpsError("failed-precondition", "Choose the original authorized source location.");
  if (!actor.organizationActions.includes(permission) && !actor.warehouseIds.includes(String(input.originWarehouseId)))
    throw new HttpsError("permission-denied", "The source warehouse is outside your action authority.");
  const originalId = previous.get("result")?.transferId;
  if (typeof originalId === "string") requireTransferActionScope(actor, await tx.get(db.doc(`transfers/${originalId}`)), permission, "source");
}

/** Outer callable boundary covers every mutation, including old early-return
 * branches and reservation services, without changing shared authorization.
 * Pending bindings survive failures so only the original command can resume. */
export function securedTransferCallable<S extends z.ZodType, Result extends Row>(
  action: string, schema: S, permission: Permission, side: TransferActionSide,
  handler: (request: CallableRequest) => Result | Promise<Result>,
) {
  return onCall({ enforceAppCheck }, async request => {
    const profile = await actionAccess(await requireAccess(request));
    requirePermission(profile, permission);
    const actor = narrowTransferWorkingContext(profile, request.data, profile.organizationActions.includes(permission), side);
    const input = parseInput(schema, request.data) as Row;
    const key = String(input.idempotencyKey);
    const fingerprint = transferCommandFingerprint(action, input);
    const entityId = entityIdentity(input);
    const reference = transferCommandRef(actor.organizationId, key);
    const previousResult = await db.runTransaction(async tx => {
      const previous = await tx.get(reference);
      await authorizeCommand(tx, actor, action, input, permission, side, previous);
      if (previous.exists) {
        if (previous.get("organizationId") !== actor.organizationId || previous.get("actorId") !== actor.userId || previous.get("action") !== action || previous.get("entityId") !== entityId || previous.get("fingerprint") !== fingerprint)
          throw new HttpsError("permission-denied", "This retry key belongs to a different actor, action, entity or payload.", { code: "TRANSFER_RETRY_MISMATCH" });
        if (previous.get("securityVersion") !== 1) reviewRetry();
        if (!["pending", "completed"].includes(String(previous.get("status")))) reviewRetry();
        if (previous.get("status") === "completed" && (!previous.get("result") || typeof previous.get("result") !== "object" || Array.isArray(previous.get("result")))) reviewRetry();
        if (previous.get("status") === "completed") return { result: previous.get("result") as Result };
        const committed = await recoverCommittedResult(tx, actor, action, input, key);
        if (!committed) return null;
        tx.update(reference, { status: "completed", result: committed, completedAt: FieldValue.serverTimestamp() });
        return { result: committed as Result };
      }
      const legacy = await tx.get(db.doc(`idempotencyKeys/${actor.organizationId}_${oldAction(action)}_${key}`));
      if (legacy.exists) reviewRetry();
      if (action === "resolveTransferDiscrepancy") {
        const discrepancy = await tx.get(db.doc(`transferDiscrepancies/${input.discrepancyId}`));
        if (discrepancy.get("resolutionIdempotencyKey") || ["resolved", "closed"].includes(String(discrepancy.get("status")))) reviewRetry();
      }
      tx.create(reference, { securityVersion: 1, organizationId: actor.organizationId, actorId: actor.userId, action, entityId, fingerprint, status: "pending", createdAt: FieldValue.serverTimestamp() });
      return null;
    });
    if (previousResult) {
      const repeated = { ...previousResult.result };
      const flags: Row = repeated;
      for (const flag of ["created", "changed", "confirmed", "verified", "sealed", "cancelled", "remainingCancelled", "closed", "reserved", "released", "resolved", "assigned", "saved", "updated", "picked"])
        if (typeof flags[flag] === "boolean") flags[flag] = false;
      return { ...repeated, repeated: true };
    }
    const result = await handler(request);
    await db.runTransaction(async tx => {
      const binding = await tx.get(reference);
      if (binding.get("securityVersion") !== 1 || binding.get("organizationId") !== actor.organizationId || binding.get("actorId") !== actor.userId || binding.get("action") !== action || binding.get("entityId") !== entityId || binding.get("fingerprint") !== fingerprint) reviewRetry();
      if (binding.get("status") === "completed") return;
      tx.update(reference, { status: "completed", result: JSON.parse(JSON.stringify(result ?? null)), completedAt: FieldValue.serverTimestamp() });
    });
    return result;
  });
}

import { z } from "zod";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import { hasRole, requireAccess, type AccessProfile } from "../auth/authorize.js";
import { environment, enforceAppCheck } from "../config.js";
import { enforceRateLimit } from "../security/rate-limit.js";
import { correlationId, parseInput } from "../utils/callable.js";
import { validateTransferInvariants } from "../transfers/validate-transfer-invariants.js";
import { logOperation } from "../observability/structured-logger.js";
import { reconcileOrganizationRequests } from "../reconciliation/warehouse-operations.js";

const reconciliationInput = z.object({ transferId: z.string().trim().min(1).max(180) });
const operationsInput = z.object({
  branchId: z.string().trim().min(1).max(180).optional(),
  warehouseId: z.string().trim().min(1).max(180).optional(),
  productId: z.string().trim().min(1).max(180).optional(),
  transferId: z.string().trim().min(1).max(180).optional(),
  requestId: z.string().trim().min(1).max(180).optional(),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

const canReconcile = (actor: AccessProfile) =>
  (["system_administrator", "operations_administrator", "auditor"] as const).some((roleId) => hasRole(actor, roleId));

export const reconcileTransfer = onCall({ enforceAppCheck }, async (request) => {
  const started = Date.now();
  const actor = await requireAccess(request);
  if (!canReconcile(actor)) throw new HttpsError("permission-denied", "Detailed reconciliation is restricted to administrators and auditors.");
  const input = parseInput(reconciliationInput, request.data);
  await enforceRateLimit({ organizationId: actor.organizationId, userId: actor.userId, operation: "transfer-reconciliation", limit: 30, windowSeconds: 60 });
  const cid = correlationId();
  const result = await validateTransferInvariants(actor.organizationId, input.transferId);
  logOperation({ correlationId: cid, functionName: "reconcileTransfer", organizationId: actor.organizationId, actorUid: actor.userId, entityType: "transfer", entityId: input.transferId, operation: "reconcile", outcome: "succeeded", durationMs: Date.now() - started });
  return result;
});

export const reconcileWarehouseOperations = onCall({ enforceAppCheck }, async (request) => {
  const actor = await requireAccess(request);
  if (!canReconcile(actor)) throw new HttpsError("permission-denied", "Operational reconciliation is restricted to administrators and auditors.");
  const input = parseInput(operationsInput, request.data);
  await enforceRateLimit({ organizationId: actor.organizationId, userId: actor.userId, operation: "operations-reconciliation", limit: 10, windowSeconds: 60 });
  const productTransferIds = input.productId
    ? new Set((await db.collection("transferItems").where("organizationId", "==", actor.organizationId).where("productId", "==", input.productId).limit(500).get()).docs.map((item) => String(item.get("transferId"))))
    : undefined;
  const transferDocs = input.transferId
    ? [await db.doc(`transfers/${input.transferId}`).get()]
    : (await db.collection("transfers").where("organizationId", "==", actor.organizationId).orderBy("createdAt", "desc").limit(input.limit).get()).docs;
  const filtered = transferDocs.filter((item) => {
    const createdAt = item.get("createdAt")?.toDate?.() as Date | undefined;
    return item.exists && item.get("organizationId") === actor.organizationId &&
      (!input.branchId || item.get("destinationBranchId") === input.branchId) &&
      (!input.warehouseId || item.get("originWarehouseId") === input.warehouseId) &&
      (!input.requestId || item.get("sourceRequestId") === input.requestId) &&
      (!productTransferIds || productTransferIds.has(item.id)) &&
      (!input.startAt || (createdAt !== undefined && createdAt.getTime() >= new Date(input.startAt).getTime())) &&
      (!input.endAt || (createdAt !== undefined && createdAt.getTime() <= new Date(input.endAt).getTime()));
  });
  const results = await Promise.all(filtered.map((item) => validateTransferInvariants(actor.organizationId, item.id)));
  const requestChecks = await reconcileOrganizationRequests(actor.organizationId);
  return {
    organizationId: actor.organizationId,
    checkedAt: new Date().toISOString(),
    summary: {
      checked: results.length,
      clean: results.filter((result) => result.status === "clean").length,
      warning: results.filter((result) => result.status === "warning").length,
      error: results.filter((result) => result.status === "error").length,
      requestFulfilmentFailures: requestChecks.filter((check) => check.status === "fail").length,
    },
    results,
    requestChecks,
    readOnly: true,
  };
});

export const systemLiveness = onCall({ enforceAppCheck: false }, async () => ({
  status: "ok",
  service: "ramadan-warehouse-functions",
  checkedAt: new Date().toISOString(),
}));

export const systemReadiness = onCall({ enforceAppCheck }, async (request) => {
  const actor = await requireAccess(request);
  if (!(["system_administrator", "operations_administrator"] as const).some((roleId) => hasRole(actor, roleId)))
    throw new HttpsError("permission-denied", "Detailed readiness is administrator-only.");
  await db.doc(`organizations/${actor.organizationId}`).get();
  const locations = await db.collection("inventoryLocations").where("organizationId", "==", actor.organizationId).where("type", "in", ["goods_in_transit", "damaged", "quarantined", "returned"]).limit(20).get();
  const kinds = new Set(locations.docs.map((item) => String(item.get("type"))));
  return {
    status: ["goods_in_transit", "damaged"].every((kind) => kinds.has(kind)) ? "ready" : "not_ready",
    checkedAt: new Date().toISOString(),
    checks: {
      firestore: "accessible",
      appEnvironment: environment.APP_ENV,
      appCheckEnforced: enforceAppCheck,
      notificationAdapter: environment.NOTIFICATION_ADAPTER_MODE,
      integrationAdapter: environment.INTEGRATION_ADAPTER_MODE,
      schedulerEnabled: environment.WAREHOUSE_SCHEDULED_FUNCTIONS_ENABLED,
      requiredVirtualLocations: Object.fromEntries(["goods_in_transit", "damaged", "quarantined", "returned"].map((kind) => [kind, kinds.has(kind)])),
    },
  };
});

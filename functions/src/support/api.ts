import { getAppCheck } from "firebase-admin/app-check";
import { onRequest, HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { adminAuth, db } from "../admin.js";
import { requireAccess } from "../auth/authorize.js";
import type { SupportActor, SupportScope } from "./domain.js";
import { supportGateway, type SupportRequest } from "./gateway.js";
import { supportRepository } from "./store.js";

const project = "ramadan-warehouse-staging";
const organizationRoles = ["system_administrator", "operations_administrator", "finance_officer", "auditor"];
export async function executeSupport(request: SupportRequest) {
  const data = request.data;
  const profile = await requireAccess(request as CallableRequest);
  let scope: SupportScope = { type: "organization", id: profile.organizationId };
  if (data.operatingContext !== undefined && data.operatingContext !== null) {
    const c = data.operatingContext as Record<string, unknown>;
    if (typeof c !== "object" || Array.isArray(c) || !["branch", "warehouse"].includes(String(c.type)) || typeof c.id !== "string" || !c.id || c.id.length > 200 || c.id.includes("/") || Object.keys(c).some(k => !["type", "id"].includes(k))) throw new HttpsError("invalid-argument", "Select a valid reporting location.");
    scope = { type: c.type as "branch" | "warehouse", id: c.id };
  } else if (!(profile.roleIds ?? [profile.roleId]).some(r => organizationRoles.includes(r))) {
    if (profile.branchIds.length === 1 && !profile.warehouseIds.length) scope = { type: "branch", id: profile.branchIds[0]! };
    else if (profile.warehouseIds.length === 1 && !profile.branchIds.length) scope = { type: "warehouse", id: profile.warehouseIds[0]! };
  }
  if (scope.type !== "organization") {
    if (!(profile.roleIds ?? [profile.roleId]).some(r => organizationRoles.includes(r)) && !(scope.type === "branch" ? profile.branchIds : profile.warehouseIds).includes(scope.id)) throw new HttpsError("permission-denied", "The reporting location is outside your assignment.");
    const location = await db.doc(`${scope.type === "branch" ? "branches" : "warehouses"}/${scope.id}`).get();
    if (!location.exists || location.get("organizationId") !== profile.organizationId || location.get("status") !== "active") throw new HttpsError("permission-denied", "The reporting location is unavailable.");
  }
  const actor: SupportActor = { ...profile, scope }, repo = supportRepository(db, actor);
  const actions: Record<string, string[]> = { create: ["report"], list: ["all", "cursor"], get: ["id"], attachment: ["id"], status: ["id", "status", "revision"], retryNotification: ["id"] };
  if (typeof data.action !== "string" || !Object.hasOwn(actions, data.action) || Object.keys(data).some(k => !["action", "operatingContext", ...actions[data.action as string]!].includes(k))) throw new HttpsError("invalid-argument", "Choose an available support action.");
  switch (data.action) {
    case "create": return repo.create(data.report);
    case "list":
      if ((data.all !== undefined && typeof data.all !== "boolean") || (data.cursor !== undefined && typeof data.cursor !== "string")) throw new HttpsError("invalid-argument", "Invalid ticket list request.");
      return repo.list(data.all === true, data.cursor as string | undefined);
    case "get": return repo.get(data.id);
    case "attachment": return repo.attachment(data.id);
    case "status": return repo.status(data.id, data.status, data.revision);
    case "retryNotification": return repo.retryNotification(data.id);
  }
}

// Private IAM transport: only the approved Gateway identity may invoke this service.
export const supportWorkspace = onRequest({ serviceAccount: `ramadan-support-api-runtime@${project}.iam.gserviceaccount.com`, invoker: "private", cors: false, maxInstances: 3, concurrency: 4, timeoutSeconds: 30, memory: "256MiB" }, async (req, res) => {
  const result = await supportGateway({ method: req.method, path: req.path, headers: req.headers, body: req.body }, project, jwt => adminAuth.verifyIdToken(jwt), token => getAppCheck().verifyToken(token), executeSupport);
  res.set(result.headers).status(result.status);
  if (result.body === undefined) res.end(); else res.json(result.body);
});

import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { db } from "../admin.js";

export interface AccessProfile {
  readonly userId: string;
  readonly organizationId: string;
  readonly roleIds: readonly string[];
  readonly permissionOverrides: readonly string[];
  readonly branchIds: readonly string[];
  readonly warehouseIds: readonly string[];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
}

export async function requireAccess(request: CallableRequest<unknown>): Promise<AccessProfile> {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication is required.");
  const snapshot = await db.collection("users").doc(request.auth.uid).get();
  if (!snapshot.exists) throw new HttpsError("permission-denied", "No warehouse access profile exists.");
  const data: unknown = snapshot.data();
  if (!data || typeof data !== "object") throw new HttpsError("internal", "The access profile is invalid.");
  const record = data as Record<string, unknown>;
  if (record.status !== "active" || typeof record.organizationId !== "string") {
    throw new HttpsError("permission-denied", "The warehouse access profile is inactive or invalid.");
  }
  return {
    userId: request.auth.uid,
    organizationId: record.organizationId,
    roleIds: stringArray(record.roleIds),
    permissionOverrides: stringArray(record.permissionOverrides),
    branchIds: stringArray(record.branchIds),
    warehouseIds: stringArray(record.warehouseIds),
  };
}

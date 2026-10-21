import { HttpsError } from "firebase-functions/v2/https";
export { HttpsError };
import type { DecodedIdToken } from "firebase-admin/auth";
import { SupportInputError } from "./domain.js";

export const supportOrigins = ["https://abramadan.svoltnigeria.com", "https://ramadan-warehouse-staging--ramadan-warehouse-staging.us-central1.hosted.app"];
export interface SupportRequest { auth: { uid: string; token: DecodedIdToken }; data: Record<string, unknown> }
export interface SupportHttpInput { method: string; path: string; headers: Record<string, string | string[] | undefined>; body: unknown }
const statuses: Record<string, number> = { "invalid-argument": 400, unauthenticated: 401, "permission-denied": 403, "not-found": 404, "failed-precondition": 400, "already-exists": 409, "resource-exhausted": 429, aborted: 409, unavailable: 503, "deadline-exceeded": 504 };
const allowedHeaders = ["authorization", "content-type", "x-firebase-appcheck", "firebase-instance-id-token"];
/** Cloud Run first checks Gateway's service identity. Verify the original user independently. */
export async function supportGateway(input: SupportHttpInput, project: string, verifyUser: (jwt: string) => Promise<DecodedIdToken>, verifyApp: (token: string) => Promise<unknown>, execute: (request: SupportRequest) => Promise<unknown>, now = () => Date.now()) {
  const headers: Record<string, string> = { "Cache-Control": "no-store", Vary: "Origin" };
  const response = (status: number, body?: unknown) => ({ status, headers, body });
  const fail = (status: number, code: string, message: string) => response(status, { error: { status: code, message } });
  const origin = input.headers.origin;
  if (origin !== undefined) {
    if (typeof origin !== "string" || !supportOrigins.includes(origin)) return fail(403, "PERMISSION_DENIED", "Origin is not allowed.");
    headers["Access-Control-Allow-Origin"] = origin;
  }
  if (input.path !== "/") return fail(404, "NOT_FOUND", "Support route unavailable.");
  if (input.method === "OPTIONS") {
    const requested = input.headers["access-control-request-headers"];
    if (!origin || input.headers["access-control-request-method"] !== "POST" || Array.isArray(requested) || (typeof requested === "string" && requested.split(",").some(h => !allowedHeaders.includes(h.trim().toLowerCase())))) return fail(403, "PERMISSION_DENIED", "Preflight is not allowed.");
    headers["Access-Control-Allow-Methods"] = "POST"; headers["Access-Control-Allow-Headers"] = allowedHeaders.join(", "); headers["Access-Control-Max-Age"] = "600";
    return response(204);
  }
  if (input.method !== "POST") { headers.Allow = "POST, OPTIONS"; return fail(405, "INVALID_ARGUMENT", "Use POST for support requests."); }
  const bearer = input.headers["x-forwarded-authorization"];
  if (typeof bearer !== "string" || bearer.length > 8192 || !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(bearer)) return fail(401, "UNAUTHENTICATED", "Ramadan sign-in is required.");
  let token: DecodedIdToken;
  try { token = await verifyUser(bearer.slice(7)); } catch { return fail(401, "UNAUTHENTICATED", "Ramadan sign-in is required."); }
  if (!project || !token || typeof token.uid !== "string" || !token.uid.length || token.uid.length > 128 || token.sub !== token.uid || token.aud !== project || token.iss !== "https://securetoken.google.com/" + project || !Number.isFinite(token.exp) || token.exp <= now() / 1000) return fail(401, "UNAUTHENTICATED", "Ramadan sign-in is required.");
  const app = input.headers["x-firebase-appcheck"];
  if (typeof app !== "string" || !app || app.length > 8192) return fail(401, "UNAUTHENTICATED", "App verification is required.");
  try { await verifyApp(app); } catch { return fail(401, "UNAUTHENTICATED", "App verification failed. Refresh Ramadan and retry."); }
  if (typeof input.headers["content-type"] !== "string" || !/^application\/json(?:\s*;.*)?$/i.test(input.headers["content-type"]) || !input.body || typeof input.body !== "object" || Array.isArray(input.body)) return fail(400, "INVALID_ARGUMENT", "Use a callable JSON request.");
  const envelope = input.body as Record<string, unknown>, data = envelope.data;
  if (Object.keys(envelope).length !== 1 || !data || typeof data !== "object" || Array.isArray(data) || Buffer.byteLength(JSON.stringify(envelope)) > 262144) return fail(400, "INVALID_ARGUMENT", "Invalid support request.");
  try { return response(200, { data: await execute({ auth: { uid: token.uid, token }, data: data as Record<string, unknown> }) }); }
  catch (error) { if (error instanceof SupportInputError) return fail(400, "INVALID_ARGUMENT", error.message); if (error instanceof HttpsError) return response(statuses[error.code] ?? 500, { error: { status: error.code.replace(/-/g, "_").toUpperCase(), message: error.message, ...(error.details ? { details: error.details } : {}) } }); return fail(500, "INTERNAL", "Support request could not complete. Check My tickets before retrying the unchanged report."); }
}

import type { AccessProfile } from "../auth/authorize.js";
export class SupportInputError extends Error {}
export const supportRecipient = "servicegurunigeria@gmail.com";
export const screenshotLimit = 128 * 1024;
export const supportStatuses = ["new", "in_progress", "resolved"] as const;
export type SupportStatus = typeof supportStatuses[number];
export type SupportScope = { type: "organization" | "branch" | "warehouse"; id: string };
export type SupportActor = Pick<AccessProfile, "organizationId" | "userId" | "roleIds" | "directRoleIds" | "branchIds" | "warehouseIds" | "authorizationVersion"> & { scope: SupportScope };
export interface SupportContext { screen: string; build: string; clientTime: string; device: "desktop" | "tablet" | "mobile" | "unknown"; browser: "Chrome" | "Firefox" | "Safari" | "Edge" | "Other"; errorReference: string }
export interface SupportInput { requestId: string; kind: "bug" | "suggestion" | "help"; description: string; expected: string; privacyConfirmed: true; context: SupportContext; screenshot?: { base64: string } }
const screens = new Set(["/", "/dashboard", "/dashboard/ceo", "/pos", "/proformas", "/invoices", "/customers", "/returns", "/aftersales", "/suppliers", "/procurement", "/expenses", "/banking", "/finance", "/accounting", "/tax", "/products", "/products/categories", "/inventory", "/inventory/opening-stock", "/inventory/receipts", "/inventory/adjustments", "/inventory/counts", "/inventory/movements", "/inventory/reconciliation", "/inventory/assets", "/daily-reconciliation", "/requests", "/requests/create", "/transfers", "/transfers/legacy", "/costs", "/reports", "/administration", "/administration/organization", "/administration/branches", "/administration/warehouses", "/administration/locations", "/administration/users", "/administration/roles", "/administration/reset", "/hr", "/audit", "/guide", "/help", "/login"]);
export function supportScreen(value: unknown) {
  if (typeof value !== "string") return "/other";
  const route = value.split(/[?#]/)[0]!;
  if (screens.has(route)) return route;
  if (/^\/(customers|products|requests)\/[^/]+$/.test(route)) return `/${route.split("/")[1]}/:id`;
  if (/^\/transfers\/simple\/[^/]+$/.test(route)) return "/transfers/simple/:id";
  if (/^\/transfers\/[^/]+$/.test(route)) return "/transfers/:id";
  return "/other";
}
export const supportCharacterCount = (value: string) => Array.from(value.trim()).length;
export function supportFormFeedback(description: string, confirmed: boolean, processing: boolean, busy: boolean) {
  const count = supportCharacterCount(description), remaining = Math.max(0, 10 - count), tooShort = count < 10, tooLong = count > 4000;
  return { count, tooShort, tooLong, description: tooShort ? `${count} / 10 minimum characters. Add ${remaining} more ${remaining === 1 ? "character" : "characters"}.` : tooLong ? `${count} characters. Shorten to 4,000 characters.` : `${count} characters. Minimum length met.`, send: busy ? "Saving your ticket…" : processing ? "Wait for the screenshot to finish processing." : tooShort ? `Send is unavailable: add ${remaining} more ${remaining === 1 ? "character" : "characters"} to the description.${!confirmed ? " Then check the privacy confirmation." : ""}` : tooLong ? "Send is unavailable: shorten the description to 4,000 characters." : !confirmed ? "Send is unavailable: check the privacy confirmation after reviewing your text and screenshot." : "Ready to send your private report." };
}
export function supportAdministrator(actor: SupportActor) { return actor.directRoleIds?.includes("system_administrator") === true; }
export function supportLocationAllowed(actor: SupportActor, scope: SupportScope) { return scope.type === "organization" || (actor.roleIds ?? []).some(r => ["system_administrator", "operations_administrator", "finance_officer", "auditor"].includes(r)) || (scope.type === "branch" ? actor.branchIds : actor.warehouseIds).includes(scope.id); }
export function supportReadable(actor: SupportActor, ticket: { organizationId: string; ownerUid: string; scope: SupportScope }) {
  if (ticket.organizationId !== actor.organizationId || (ticket.ownerUid !== actor.userId && !supportAdministrator(actor))) return false;
  if (actor.scope.type !== "organization" && (actor.scope.type !== ticket.scope.type || actor.scope.id !== ticket.scope.id)) return false;
  if (ticket.scope.type === "organization") return true;
  if (supportAdministrator(actor)) return true;
  return supportLocationAllowed(actor, ticket.scope);
}
export function sanitizeSupportContext(value: unknown): SupportContext {
  const c = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return { screen: supportScreen(c.screen), build: typeof c.build === "string" && /^[-a-zA-Z0-9_.:]{1,80}$/.test(c.build) ? c.build : "unknown", clientTime: typeof c.clientTime === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(c.clientTime) && Number.isFinite(Date.parse(c.clientTime)) ? c.clientTime : "", device: ["desktop", "tablet", "mobile"].includes(String(c.device)) ? c.device as SupportContext["device"] : "unknown", browser: ["Chrome", "Firefox", "Safari", "Edge"].includes(String(c.browser)) ? c.browser as SupportContext["browser"] : "Other", errorReference: typeof c.errorReference === "string" && /^[-a-zA-Z0-9_]{1,80}$/.test(c.errorReference) ? c.errorReference : "" };
}
export function validateSupportInput(value: unknown): SupportInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SupportInputError("Describe the issue.");
  const d = value as Record<string, unknown>;
  if (Object.keys(d).some(k => !["requestId", "kind", "description", "expected", "privacyConfirmed", "context", "screenshot"].includes(k))) throw new SupportInputError("Unsupported report field.");
  if (typeof d.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(d.requestId)) throw new SupportInputError("Invalid report request reference.");
  if (!["bug", "suggestion", "help"].includes(String(d.kind))) throw new SupportInputError("Choose bug, suggestion or help.");
  if (typeof d.description !== "string" || supportCharacterCount(d.description) < 10 || supportCharacterCount(d.description) > 4000 || d.description.length > 8000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(d.description)) throw new SupportInputError("Use 10–4,000 characters to describe the issue, excluding spaces at the ends.");
  if (d.expected !== undefined && (typeof d.expected !== "string" || supportCharacterCount(d.expected) > 2000 || d.expected.length > 4000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(d.expected))) throw new SupportInputError("Expected outcome must be 2,000 characters or fewer.");
  if (d.privacyConfirmed !== true) throw new SupportInputError("Review the text and screenshot and confirm the privacy notice.");
  let screenshot: SupportInput["screenshot"];
  if (d.screenshot !== undefined) {
    const image = d.screenshot as Record<string, unknown>;
    if (!image || typeof image !== "object" || Object.keys(image).some(k => k !== "base64") || typeof image.base64 !== "string" || image.base64.length > Math.ceil(screenshotLimit / 3) * 4 || !/^([A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image.base64)) throw new SupportInputError("Choose a cropped PNG screenshot of 128 KB or less after processing.");
    screenshot = { base64: image.base64 };
  }
  return { requestId: d.requestId.toLowerCase(), kind: d.kind as SupportInput["kind"], description: d.description.trim(), expected: typeof d.expected === "string" ? d.expected.trim() : "", privacyConfirmed: true, context: sanitizeSupportContext(d.context), ...(screenshot ? { screenshot } : {}) };
}
export function supportSubject(id: string) { return "[Ramadan Support] Ticket " + id; }

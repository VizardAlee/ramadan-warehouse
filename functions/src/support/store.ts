import { createHash, randomUUID } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { accessProfileFromRecord } from "../auth/authorize.js";
import { privateScreenshot } from "./image.js";
import { supportAdministrator, supportLocationAllowed, supportReadable, supportRecipient, supportStatuses, supportSubject, validateSupportInput, type SupportActor, type SupportContext, type SupportScope, type SupportStatus } from "./domain.js";
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const ticketId = (organization: string, uid: string, requestId: string) => "RS-" + digest([organization, uid, requestId.toLowerCase()]).slice(0, 32);
const identifier = (value: unknown) => { if (typeof value !== "string" || !/^RS-[a-f0-9]{32}$/.test(value)) throw new HttpsError("not-found", "Ticket unavailable."); return value; };
interface Ticket { id: string; organizationId: string; ownerUid: string; scope: SupportScope; kind: string; description: string; expected: string; context: SupportContext; roles: string[]; hasScreenshot: boolean; status: SupportStatus; revision: number; createdAt: number; updatedAt: number; fingerprint: string }
export interface SupportMail { to: string; subject: string; text: string; attachment?: { filename: string; contentType: "image/png"; base64: string }; idempotencyKey: string }
export interface SupportTransport { send(mail: SupportMail): Promise<{ accepted: true; providerReference: string }> }
export class SupportDeliveryRejected extends Error {}
export class SupportDeliveryUncertain extends Error {}
export function supportRepository(db: Firestore, actor: SupportActor, now = () => Date.now()) {
  if (!actor.organizationId || actor.organizationId.includes("/") || !actor.userId) throw new HttpsError("permission-denied", "Active warehouse access is required.");
  const root = db.collection("supportOrganizations").doc(actor.organizationId), tickets = root.collection("tickets"), owners = root.collection("owners").doc(digest(actor.userId)).collection("tickets"), attachments = root.collection("attachments");
  const canRead = (ticket: Ticket) => supportReadable(actor, ticket);
  const visible = (t: Ticket) => ({ id: t.id, ...(supportAdministrator(actor) ? { submittedByUid: t.ownerUid } : {}), kind: t.kind, description: t.description, expected: t.expected, context: t.context, scope: t.scope, roles: t.roles, hasScreenshot: t.hasScreenshot, status: t.status, revision: t.revision, createdAt: t.createdAt, updatedAt: t.updatedAt });
  async function current(tx: Transaction, admin = false) {
    const [user, organization] = await Promise.all([tx.get(db.doc(`users/${actor.userId}`)), tx.get(db.doc(`organizations/${actor.organizationId}`))]);
    if (!user.exists || !organization.exists || organization.get("status") !== "active") throw new HttpsError("permission-denied", "Warehouse access is unavailable.");
    const fresh = accessProfileFromRecord(actor.userId, user.data()!);
    if (fresh.organizationId !== actor.organizationId || fresh.authorizationVersion !== actor.authorizationVersion) throw new HttpsError("permission-denied", "Authorization changed. Refresh your session.");
    const updated: SupportActor = { ...fresh, scope: actor.scope };
    if (!supportLocationAllowed(updated, actor.scope)) throw new HttpsError("permission-denied", "The report location is outside your current assignment.");
    if (admin && !supportAdministrator(updated)) throw new HttpsError("permission-denied", "Support administration requires a built-in system administrator.");
  }
  async function get(value: unknown) {
    const id = identifier(value), t = (await tickets.doc(id).get()).data() as Ticket | undefined;
    if (!t || !canRead(t)) throw new HttpsError("not-found", "Ticket unavailable.");
    const mail = (await db.doc(`supportMailOutbox/${id}`).get()).data();
    return { ...visible(t), notification: mail?.state === "sent" ? "sent" : "pending", ...(supportAdministrator(actor) ? { notificationState: mail?.state ?? "pending", canRetryNotification: ["failed", "unconfigured"].includes(mail?.state) && Number(mail?.attempts ?? 0) < 5 } : {}) };
  }
  async function create(value: unknown) {
    const input = validateSupportInput(value), image = input.screenshot ? privateScreenshot(input.screenshot.base64) : null;
    const clean = { kind: input.kind, description: input.description, expected: input.expected, context: input.context, scope: actor.scope, image: image?.base64 ?? null };
    const fingerprint = digest(clean), id = ticketId(actor.organizationId, actor.userId, input.requestId), time = now();
    await db.runTransaction(async tx => {
      await current(tx);
      const ref = tickets.doc(id), old = await tx.get(ref);
      if (old.exists) { const t = old.data() as Ticket; if (!canRead(t) || t.fingerprint !== fingerprint) throw new HttpsError("already-exists", "This request reference belongs to different report content. Check My tickets and retry the unchanged report."); return; }
      const userRef = root.collection("limits").doc("user-" + digest(actor.userId)), orgRef = root.collection("limits").doc("organization");
      const [user, org] = await Promise.all([tx.get(userRef), tx.get(orgRef)]), day = new Date(time + 3600000).toISOString().slice(0, 10);
      const recent = (Array.isArray(user.get("recent")) ? user.get("recent") as number[] : []).filter(t => Number.isFinite(t) && t > time - 300000);
      const userCount = user.get("day") === day ? Number(user.get("count")) : 0, orgCount = org.get("day") === day ? Number(org.get("count")) : 0;
      if (!Number.isSafeInteger(userCount) || userCount < 0 || !Number.isSafeInteger(orgCount) || orgCount < 0 || recent.length >= 3 || userCount >= 10 || orgCount >= 200) throw new HttpsError("resource-exhausted", "Reporting limit reached. Existing tickets remain available; try again later.");
      const ticket: Ticket = { id, organizationId: actor.organizationId, ownerUid: actor.userId, scope: actor.scope, kind: input.kind, description: input.description, expected: input.expected, context: input.context, roles: [...(actor.roleIds ?? [])], hasScreenshot: Boolean(image), status: "new", revision: 1, createdAt: time, updatedAt: time, fingerprint };
      tx.create(ref, ticket); tx.create(owners.doc(id), { id, createdAt: time });
      if (image) tx.create(attachments.doc(id), { ...image, organizationId: actor.organizationId, ownerUid: actor.userId });
      tx.create(db.doc(`supportMailOutbox/${id}`), { ticketId: id, organizationId: actor.organizationId, state: "pending", attempts: 0, createdAt: time });
      tx.set(userRef, { day, count: userCount + 1, recent: [...recent, time] }); tx.set(orgRef, { day, count: orgCount + 1 });
    });
    return get(id);
  }
  async function list(all = false, cursor?: string) {
    if (all && !supportAdministrator(actor)) throw new HttpsError("permission-denied", "Support administration is unavailable.");
    const scopeKey = digest([actor.organizationId, actor.userId, actor.scope, all]);
    let query = (all ? tickets : owners).orderBy("createdAt", "desc").orderBy("__name__", "desc").limit(21);
    if (cursor) {
      let c: unknown; try { if (cursor.length > 1024) throw Error(); c = JSON.parse(Buffer.from(cursor, "base64url").toString()); } catch { throw new HttpsError("invalid-argument", "Invalid ticket page."); }
      if (!Array.isArray(c) || c.length !== 3 || c[0] !== scopeKey || !Number.isSafeInteger(c[1]) || c[1] < 0) throw new HttpsError("invalid-argument", "Ticket page belongs to a different account or location.");
      query = query.startAfter(c[1], identifier(c[2]));
    }
    const rows = (await query.get()).docs, selected = rows.slice(0, 20), data = all ? selected : selected.length ? await db.getAll(...selected.map(d => tickets.doc(d.id))) : [];
    const result = data.map(d => d.data() as Ticket | undefined).filter((t): t is Ticket => Boolean(t && canRead(t))).map(visible), last = selected.at(-1);
    return { tickets: result, nextCursor: rows.length > 20 && last ? Buffer.from(JSON.stringify([scopeKey, last.get("createdAt"), last.id])).toString("base64url") : null, canAdmin: supportAdministrator(actor) };
  }
  async function attachment(value: unknown) { const t = await get(value), raw = (await tickets.doc(t.id).get()).data(), image = (await attachments.doc(t.id).get()).data(); if (!raw || !image || image.organizationId !== actor.organizationId || image.ownerUid !== raw.ownerUid) throw new HttpsError("not-found", "Screenshot unavailable."); return { mimeType: "image/png", base64: image.base64 as string, bytes: image.bytes as number }; }
  async function status(value: unknown, next: unknown, revision: unknown) {
    if (!supportStatuses.includes(next as SupportStatus) || !Number.isSafeInteger(revision) || Number(revision) < 1) throw new HttpsError("invalid-argument", "Choose an available status and current revision.");
    const id = identifier(value);
    await db.runTransaction(async tx => { await current(tx, true); const ref = tickets.doc(id), t = (await tx.get(ref)).data() as Ticket | undefined; if (!t || !canRead(t)) throw new HttpsError("not-found", "Ticket unavailable."); if (t.revision !== revision) throw new HttpsError("aborted", "Ticket changed. Refresh before updating."); if (t.status === next) return; tx.update(ref, { status: next, revision: t.revision + 1, updatedAt: now() }); tx.create(ref.collection("audit").doc(), { actorUid: actor.userId, from: t.status, to: next, at: now() }); });
    return get(id);
  }
  async function retryNotification(value: unknown) {
    const id = identifier(value);
    await db.runTransaction(async tx => { await current(tx, true); const ticket = (await tx.get(tickets.doc(id))).data() as Ticket | undefined, ref = db.doc(`supportMailOutbox/${id}`), row = (await tx.get(ref)).data(); if (!ticket || !canRead(ticket) || !row) throw new HttpsError("not-found", "Ticket unavailable."); if (!["failed", "unconfigured"].includes(row.state) || row.attempts >= 5) throw new HttpsError("failed-precondition", "Only confirmed unsent notifications may be queued again. Uncertain delivery must be reconciled first."); tx.update(ref, { state: "pending", requestedAt: now(), requestedBy: actor.userId }); });
    return get(id);
  }
  return { create, get, list, attachment, status, retryNotification };
}
/** Claim before SMTP. An interrupted or ambiguous send is never automatically replayed. */
export async function deliverSupportNotification(db: Firestore, id: string, transport?: SupportTransport, now = () => Date.now()) {
  identifier(id); const ref = db.doc(`supportMailOutbox/${id}`), lease = randomUUID(), time = now();
  const mail = await db.runTransaction(async tx => {
    const row = (await tx.get(ref)).data(); if (!row) return null;
    if (typeof row.organizationId !== "string" || !row.organizationId || row.organizationId.includes("/") || row.ticketId !== id || !Number.isSafeInteger(row.attempts) || row.attempts < 0) { tx.update(ref, { state: "blocked", lastCode: "invalid-outbox" }); return null; }
    if (row.state === "sending") { if (Number(row.leaseUntil) < time) tx.update(ref, { state: "uncertain", lastCode: "interrupted-send", finishedAt: time }); return null; }
    if (!["pending", "unconfigured"].includes(row.state) || row.attempts >= 5) return null;
    const root = db.collection("supportOrganizations").doc(row.organizationId), ticket = (await tx.get(root.collection("tickets").doc(id))).data() as Ticket | undefined, organization = await tx.get(db.doc(`organizations/${row.organizationId}`));
    if (!ticket || ticket.organizationId !== row.organizationId || !organization.exists || organization.get("status") !== "active") { tx.update(ref, { state: "blocked", lastCode: "organization-unavailable" }); return null; }
    const image = ticket.hasScreenshot ? (await tx.get(root.collection("attachments").doc(id))).data() : null;
    if (ticket.hasScreenshot && (!image || image.organizationId !== ticket.organizationId || image.ownerUid !== ticket.ownerUid)) { tx.update(ref, { state: "blocked", lastCode: "attachment-unavailable" }); return null; }
    if (!transport) { tx.update(ref, { state: "unconfigured", lastCode: "provider-not-configured" }); return null; }
    tx.update(ref, { state: "sending", lease, leaseUntil: time + 120000, attempts: Number(row.attempts) + 1, attemptedAt: time });
    return { to: supportRecipient, subject: supportSubject(id), text: ["Ramadan private support ticket " + id, "Type: " + ticket.kind, "Authenticated account: " + ticket.ownerUid, "Organization: " + ticket.organizationId, "Reporting location: " + JSON.stringify(ticket.scope), "Description:", ticket.description, "Expected outcome:", ticket.expected, "Context:", JSON.stringify(ticket.context), "Location kind: " + ticket.scope.type, "Private authenticated ticket: https://abramadan.svoltnigeria.com/help?ticket=" + id, "No automatic customer reply has been sent."].join("\n"), ...(image ? { attachment: { filename: id + ".png", contentType: "image/png" as const, base64: image.base64 as string } } : {}), idempotencyKey: row.organizationId + ":" + id } satisfies SupportMail;
  });
  if (!mail || !transport) return;
  let result: { state: string; lastCode: string; providerReference?: string };
  try { const sent = await transport.send(mail); if (sent.accepted !== true) throw new SupportDeliveryUncertain(); result = { state: "sent", lastCode: "accepted", providerReference: sent.providerReference.slice(0, 200) }; }
  catch (error) { result = { state: error instanceof SupportDeliveryRejected ? "failed" : "uncertain", lastCode: error instanceof SupportDeliveryRejected ? "delivery-rejected" : "delivery-unconfirmed" }; }
  await db.runTransaction(async tx => { const row = (await tx.get(ref)).data(); if (row?.state === "sending" && row.lease === lease) tx.update(ref, { ...result, finishedAt: now() }); });
}

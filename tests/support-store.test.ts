import { randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { describe, expect, it, vi } from "vitest";
vi.mock("../functions/src/admin", () => ({ db: {} }));
import { deliverSupportNotification, SupportDeliveryRejected, supportRepository, ticketId, type SupportTransport } from "../functions/src/support/store";
import type { SupportActor } from "../functions/src/support/domain";
import { SupportMemoryFirestore } from "./helpers/support-memory-firestore";
const time = Date.parse("2026-10-21T12:00:00Z");
const actor: SupportActor = { organizationId: "org", userId: "owner", authorizationVersion: 1, roleIds: ["sales_cashier"], directRoleIds: ["sales_cashier"], branchIds: ["one"], warehouseIds: [], scope: { type: "branch", id: "one" } };
const admin: SupportActor = { ...actor, userId: "administrator", roleIds: ["system_administrator"], directRoleIds: ["system_administrator"], branchIds: [], scope: { type: "organization", id: "org" } };
const report = () => ({ requestId: randomUUID(), kind: "bug", description: "Synthetic support issue for tests", privacyConfirmed: true, context: { screen: "/pos", build: "test", clientTime: "2026-10-21T12:00:00Z" } });
function setup() {
  const memory = new SupportMemoryFirestore();
  const seedUser = (a: SupportActor) => memory.seed("users/" + a.userId, { ...a, roleId: a.roleIds?.[0], status: "active" });
  memory.seed("organizations/org", { status: "active" }); seedUser(actor); seedUser(admin);
  const db = memory as unknown as Firestore;
  return { memory, db, seedUser, repo: (a = actor, now = () => time) => supportRepository(db, a, now) };
}
const root = "supportOrganizations/org/tickets/";
describe("private support ticket transactions and boundaries", () => {
  it("atomically saves the receipt, owner index, outbox and limits without changing business records", async () => {
    const { memory, repo } = setup(), original = structuredClone([...memory.rows]);
    memory.seed("sales/private-sale", { amount: 4200 });
    const result = await repo().create(report());
    expect(result).toMatchObject({ status: "new", revision: 1, notification: "pending" });
    expect(memory.rows.get("supportMailOutbox/" + result.id)).toMatchObject({ state: "pending", attempts: 0 });
    for (const [path, row] of original) expect(memory.rows.get(path)).toEqual(row);
    expect(memory.rows.get("sales/private-sale")).toEqual({ amount: 4200 });
    expect([...memory.rows].filter(([p]) => p.includes("/owners/")).length).toBe(1);
    expect(result).not.toHaveProperty("fingerprint"); expect(result).not.toHaveProperty("submittedByUid");
  });
  it("deduplicates parallel same-reference submissions and rejects changed content", async () => {
    const { memory, repo } = setup(), input = report();
    const [one,two] = await Promise.all([repo().create(input), repo().create(input)]);
    expect(one.id).toBe(two.id); expect([...memory.rows.keys()].filter(p => p.startsWith(root))).toHaveLength(1);
    expect([...memory.rows].find(([p]) => p.includes("/limits/user-"))?.[1].count).toBe(1);
    await expect(repo().create({ ...input, description: "Different synthetic description" })).rejects.toMatchObject({ code: "already-exists" });
    expect(ticketId("org", "owner", input.requestId.toUpperCase())).toBe(one.id);
  });
  it("enforces rolling user and Lagos-day user/organization creation limits", async () => {
    const { memory, repo } = setup();
    for (let n = 0; n < 3; n++) await repo().create(report());
    await expect(repo().create(report())).rejects.toMatchObject({ code: "resource-exhausted" });
    for (let n = 3; n < 10; n++) await repo(actor, () => time + n * 360000).create(report());
    await expect(repo(actor, () => time + 3600000).create(report())).rejects.toMatchObject({ code: "resource-exhausted" });
    memory.seed("supportOrganizations/org/limits/organization", { day: "2026-10-22", count: 200 });
    await expect(repo(actor, () => time + 86400000).create(report())).rejects.toMatchObject({ code: "resource-exhausted" });
  });
  it.each(["disabled", "version", "assignment", "organization"])("rechecks current authority inside the write transaction: %s", async change => {
    const { memory, repo } = setup(), row = memory.rows.get("users/owner")!;
    if (change === "organization") memory.seed("organizations/org", { status: "archived" });
    else memory.seed("users/owner", { ...row, ...(change === "disabled" ? { authDisabled: true } : change === "version" ? { authorizationVersion: 2 } : { branchIds: [] }) });
    await expect(repo().create(report())).rejects.toMatchObject({ code: "permission-denied" });
    expect([...memory.rows.keys()].some(p => p.startsWith(root))).toBe(false);
  });
  it("keeps tenant/owner/private-queue and selected-location isolation", async () => {
    const { repo, seedUser } = setup(), saved = await repo().create(report());
    const other: SupportActor = { ...actor, userId: "other" }; seedUser(other);
    await expect(repo(other).get(saved.id)).rejects.toMatchObject({ code: "not-found" });
    await expect(repo({ ...actor, organizationId: "foreign" }).get(saved.id)).rejects.toMatchObject({ code: "not-found" });
    await expect(repo().list(true)).rejects.toMatchObject({ code: "permission-denied" });
    await expect(repo({ ...admin, directRoleIds: [] }).get(saved.id)).rejects.toMatchObject({ code: "not-found" });
    await expect(repo({ ...admin, scope: { type: "branch", id: "two" } }).get(saved.id)).rejects.toMatchObject({ code: "not-found" });
    expect(await repo(admin).get(saved.id)).toMatchObject({ submittedByUid: "owner" });
  });
  it("bounds scan pages and binds cursors to account, selected location and queue", async () => {
    const { memory, repo } = setup(), saved = await repo().create(report()), original = memory.rows.get(root + saved.id)!;
    for (let n = 1; n <= 25; n++) { const id = "RS-" + n.toString(16).padStart(32, "0"); memory.seed(root + id, { ...original, id, createdAt: time + n, scope: { type: "branch", id: "two" } }); }
    const page = await repo({ ...admin, scope: actor.scope }).list(true);
    expect(page.tickets).toHaveLength(0); expect(page.nextCursor).toBeTruthy(); expect(memory.querySizes.at(-1)).toBe(21);
    const next = await repo({ ...admin, scope: actor.scope }).list(true, page.nextCursor!); expect(next.tickets.map(t => t.id)).toContain(saved.id);
    await expect(repo(admin).list(true, page.nextCursor!)).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(repo(admin).list(true, "broken")).rejects.toMatchObject({ code: "invalid-argument" });
  });
  it("uses status revisions and records exactly one concurrent administrator transition", async () => {
    const { memory, repo } = setup(), saved = await repo().create(report());
    await expect(repo().status(saved.id, "resolved", 1)).rejects.toMatchObject({ code: "permission-denied" });
    const results = await Promise.allSettled([repo(admin).status(saved.id, "in_progress", 1), repo(admin).status(saved.id, "resolved", 1)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1); expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
    expect([...memory.rows.keys()].filter(p => p.includes("/audit/"))).toHaveLength(1);
    expect((await repo().get(saved.id)).revision).toBe(2);
  });
  it("leaves no partial receipt or outbox when commit fails", async () => {
    const { memory, repo } = setup(); memory.failCommit = true;
    await expect(repo().create(report())).rejects.toThrow("commit failure");
    expect([...memory.rows.keys()].some(p => p.startsWith("support"))).toBe(false);
  });
});
describe("durable support mail outcomes", () => {
  it("retains saved tickets without a provider and sends only once under overlapping runs", async () => {
    const { memory, db, repo } = setup(), saved = await repo().create(report());
    await deliverSupportNotification(db, saved.id); expect(memory.rows.get("supportMailOutbox/" + saved.id)?.state).toBe("unconfigured");
    const send = vi.fn(async () => ({ accepted: true as const, providerReference: "synthetic-provider" }));
    await Promise.all([deliverSupportNotification(db, saved.id, { send }), deliverSupportNotification(db, saved.id, { send })]);
    expect(send).toHaveBeenCalledTimes(1); expect(await repo().get(saved.id)).toMatchObject({ notification: "sent" });
    await deliverSupportNotification(db, saved.id, { send }); expect(send).toHaveBeenCalledTimes(1);
  });
  it("allows an explicit administrator retry only after confirmed rejection", async () => {
    const { db, repo } = setup(), saved = await repo().create(report());
    await deliverSupportNotification(db, saved.id, { send: async () => { throw new SupportDeliveryRejected(); } });
    expect(await repo(admin).get(saved.id)).toMatchObject({ notificationState: "failed", canRetryNotification: true });
    await expect(repo().retryNotification(saved.id)).rejects.toMatchObject({ code: "permission-denied" });
    await repo(admin).retryNotification(saved.id);
    const send = vi.fn(async () => ({ accepted: true as const, providerReference: "accepted" })); await deliverSupportNotification(db, saved.id, { send }); expect(send).toHaveBeenCalledOnce();
  });
  it("does not replay ambiguous delivery or an interrupted sending lease", async () => {
    const { memory, db, repo } = setup(), saved = await repo().create(report()), path = "supportMailOutbox/" + saved.id;
    const send = vi.fn(async () => { throw Error("Synthetic connection lost after DATA"); });
    await deliverSupportNotification(db, saved.id, { send }); await deliverSupportNotification(db, saved.id, { send }); expect(send).toHaveBeenCalledOnce();
    expect(await repo(admin).get(saved.id)).toMatchObject({ notificationState: "uncertain", canRetryNotification: false });
    await expect(repo(admin).retryNotification(saved.id)).rejects.toMatchObject({ code: "failed-precondition" });
    memory.seed(path, { ...memory.rows.get(path), state: "sending", leaseUntil: time - 1 });
    await deliverSupportNotification(db, saved.id, { send }, () => time); expect(memory.rows.get(path)?.state).toBe("uncertain"); expect(send).toHaveBeenCalledOnce();
  });
  it("does not send if the claim cannot commit and avoids replay after an acknowledgement-write failure", async () => {
    const { memory, db, repo } = setup(), saved = await repo().create(report()), path = "supportMailOutbox/" + saved.id;
    const send = vi.fn(async () => { memory.failCommit = true; return { accepted: true as const, providerReference: "accepted" }; });
    memory.failCommit = true; await expect(deliverSupportNotification(db, saved.id, { send }, () => time)).rejects.toThrow(); expect(send).not.toHaveBeenCalled();
    memory.failCommit = false; await expect(deliverSupportNotification(db, saved.id, { send }, () => time)).rejects.toThrow(); expect(send).toHaveBeenCalledOnce();
    expect(memory.rows.get(path)?.state).toBe("sending"); memory.failCommit = false;
    await deliverSupportNotification(db, saved.id, { send }, () => time + 120001); expect(memory.rows.get(path)?.state).toBe("uncertain"); expect(send).toHaveBeenCalledOnce();
  });
  it.each(["inactive", "invalid-attempts", "wrong-ticket", "wrong-attachment-owner"])("blocks unsafe queue state without contacting SMTP: %s", async mode => {
    const { memory, db, repo } = setup(), saved = await repo().create(report()), path = "supportMailOutbox/" + saved.id;
    if (mode === "inactive") memory.seed("organizations/org", { status: "archived" });
    else if (mode === "wrong-attachment-owner") { memory.seed(root + saved.id, { ...memory.rows.get(root + saved.id), hasScreenshot: true }); memory.seed("supportOrganizations/org/attachments/" + saved.id, { organizationId: "org", ownerUid: "another", base64: "AA==" }); }
    else memory.seed(path, { ...memory.rows.get(path), ...(mode === "invalid-attempts" ? { attempts: -1 } : { ticketId: "RS-other" }) });
    const transport: SupportTransport = { send: vi.fn() }; await deliverSupportNotification(db, saved.id, transport); expect(transport.send).not.toHaveBeenCalled(); expect(memory.rows.get(path)?.state).toBe("blocked");
  });
});

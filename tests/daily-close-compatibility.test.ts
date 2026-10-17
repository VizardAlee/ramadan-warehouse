import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Timestamp } from "firebase-admin/firestore";
const state = vi.hoisted(() => ({ rows: [] as Array<{ id: string; at: Timestamp; debit: number }>, current: {} as Record<string, unknown>, update: vi.fn(), create: vi.fn(), set: vi.fn() }));
vi.mock("../functions/src/admin.js", () => ({ db: {
  collection: (name: string) => ({ name, where() { return this; }, orderBy() { return this; }, limit() { return this; } }),
  doc: (path: string) => ({ path, id: path.split("/").at(-1), collection: (name: string) => ({ doc: (id: string) => ({ path: `${path}/${name}/${id}` }) }) }),
  runTransaction: async (handler: (tx: unknown) => unknown) => handler(reader()),
} }));
vi.mock("../functions/src/auth/authorize.js", async importOriginal => ({
  ...await importOriginal<typeof import("../functions/src/auth/authorize")>(),
  requireAccess: async () => ({ userId: "manager", organizationId: "org", roleId: "system_administrator", branchIds: ["store"], warehouseIds: [], authorizationVersion: 1 }),
}));
vi.mock("../functions/src/config.js", () => ({ enforceAppCheck: false }));
vi.mock("../functions/src/audit/write-audit-log.js", () => ({ writeAuditLog: vi.fn() }));
import { dailyBounds, dailyEvidence, dailyEvidenceMatches } from "../functions/src/accounting/daily-close";
import { getDailyCloseWorkspace, prepareDailyClose, signDailyClose } from "../functions/src/callable/daily-close";
const date = "2026-10-16", bounds = dailyBounds(date), Stamp = bounds.start.constructor as typeof Timestamp;
function getPath(data: Record<string, unknown>, key: string): unknown { return key.split(".").reduce<unknown>((value, part) => value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined, data); }
function reader() {
  const get = async (ref: { path?: string; name?: string }) => {
    if (ref.name) { const docs = ref.name === "journalLines" ? state.rows.map(row => ({ id: row.id, get: (key: string) => ({ effectiveAt: row.at, debitMinor: row.debit, creditMinor: 0, journalEntryId: "j" })[key as "effectiveAt"], updateTime: bounds.start })) : []; return { docs, size: docs.length }; }
    const data = ref.path?.startsWith("branches/") ? { organizationId: "org", name: "Store" } : ref.path?.startsWith("dailyCloses/") ? state.current : null;
    return { exists: Boolean(data), id: ref.path?.split("/").at(-1), get: (key: string) => data ? getPath(data, key) : undefined, data: () => data };
  };
  return { get, getAll: (...refs: Array<{ path: string }>) => Promise.all(refs.map(get)), update: state.update, create: state.create, set: state.set };
}
const readEvidence = () => dailyEvidence(reader() as unknown as FirebaseFirestore.Transaction, "org", "store", date);
// Independent legacy fixture: the pre-correction format had one toMillis value
// per cash line and no hashVersion. It is never written into a live database.
function legacyEvidence(row = state.rows[0]!) {
  const evidence = { cash: { openingMinor: 0, receiptsMinor: row.debit, paymentsMinor: 0, closingMinor: row.debit, lineCount: 1 }, stockCounts: [], openShiftCount: 0, closedShiftCount: 0, tillVarianceMinor: 0, exceptions: ["No completed physical stock count is linked to this store and date."] };
  const hash = createHash("sha256").update(JSON.stringify([row.id, row.at.toMillis(), row.debit, 0, "j"])).update(JSON.stringify(["org", "store", date, evidence])).digest("hex");
  return { ...evidence, hash };
}
async function workspace() {
  const result = await getDailyCloseWorkspace.run({ data: { branchId: "store", date } } as Parameters<typeof getDailyCloseWorkspace.run>[0]);
  if (!("evidence" in result)) throw new Error("Expected daily evidence, not the locations route");
  return result;
}
beforeEach(() => {
  vi.clearAllMocks(); state.rows = [{ id: "cash", at: Stamp.fromMillis(bounds.start.toMillis() + 3600000), debit: 100 }];
  state.current = { organizationId: "org", branchId: "store", date, version: 1, status: "prepared", evidence: legacyEvidence(), countedCashMinor: 100, explanation: "Checked physical cash", preparedBy: "manager" };
});
describe("daily-close legacy evidence compatibility", () => {
  it.each(["prepared", "signed"])("retains unchanged %s evidence without historical writes", async status => {
    state.current.status = status; const before = structuredClone(state.current);
    const result = await workspace(); expect(result).toMatchObject({ evidenceChanged: false, close: before });
    expect(result.evidence.hash).not.toBe((state.current.evidence as {hash:string}).hash);
    expect(state.current).toEqual(before); expect(state.update).not.toHaveBeenCalled(); expect(state.set).not.toHaveBeenCalled(); expect(state.create).not.toHaveBeenCalled();
  });
  it("preserves unchanged legacy submillisecond evidence", async () => {
    state.rows[0]!.at = new Stamp(state.rows[0]!.at.seconds, 123456789); state.current.evidence = legacyEvidence();
    expect((await workspace()).evidenceChanged).toBe(false);
  });
  it("signs unchanged prepared legacy evidence with its original hash and a strict new validation hash", async () => {
    const prepared = structuredClone(state.current.evidence);
    await signDailyClose.run({ data: { branchId: "store", date, version: 1, idempotencyKey: crypto.randomUUID() } } as Parameters<typeof signDailyClose.run>[0]);
    expect(state.update).toHaveBeenCalledOnce();
    const update = state.update.mock.calls[0]![1]; expect(update).not.toHaveProperty("evidence"); expect(update.validatedEvidence).toMatchObject({ hashVersion: 2 });
    const signOff = state.create.mock.calls.find(([ref]) => ref.path.includes("/signOffs/"))![1];
    expect(signOff.evidenceHash).toBe((prepared as {hash:string}).hash); expect(signOff.validatedEvidenceHash).toBe(update.validatedEvidence.hash);
    expect(state.current.evidence).toEqual(prepared);
  });
  it("keeps unchanged signed legacy evidence locked against an unnecessary revision", async () => {
    state.current.status = "signed"; const live = await readEvidence();
    await expect(prepareDailyClose.run({ data: { branchId: "store", date, countedCashMinor: 100, evidenceHash: live.hash, explanation: "Already signed", idempotencyKey: crypto.randomUUID() } } as Parameters<typeof prepareDailyClose.run>[0])).rejects.toMatchObject({ code: "failed-precondition" });
    expect(state.set).not.toHaveBeenCalled();
  });
  it("still rejects changed cash and newly included final-nanosecond evidence", async () => {
    state.rows[0]!.debit += 1; expect((await workspace()).evidenceChanged).toBe(true);
    state.rows[0]!.debit -= 1; state.rows.push({ id: "last", at: new Stamp(bounds.end.seconds - 1, 999999999), debit: 7 });
    expect((await workspace()).evidenceChanged).toBe(true);
    await expect(signDailyClose.run({ data: { branchId: "store", date, version: 1, idempotencyKey: crypto.randomUUID() } } as Parameters<typeof signDailyClose.run>[0])).rejects.toMatchObject({ code: "failed-precondition" });
    expect(state.update).not.toHaveBeenCalled();
  });
  it("never falls back for new or unknown versions, including nanosecond changes invisible to legacy milliseconds", async () => {
    state.rows[0]!.at = new Stamp(state.rows[0]!.at.seconds, 123456001); const live = await readEvidence();
    const old = { hash: live.hash, hashVersion: 2 };
    state.rows[0]!.at = new Stamp(state.rows[0]!.at.seconds, 123456002); const changed = await readEvidence();
    expect(changed.legacyHash).toBe(live.legacyHash); expect(changed.hash).not.toBe(live.hash);
    expect(dailyEvidenceMatches(old, changed)).toBe(false);
    expect(dailyEvidenceMatches({ hash: changed.legacyHash, hashVersion: 2 }, changed)).toBe(false);
    expect(dailyEvidenceMatches({ hash: changed.hash, hashVersion: 99 }, changed)).toBe(false);
    state.current.validatedEvidence = old; state.current.evidence = { hash: changed.legacyHash };
    expect((await workspace()).evidenceChanged).toBe(true);
  });
});

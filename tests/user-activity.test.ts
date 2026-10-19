import { createRequire } from "node:module";
const { Timestamp } = createRequire(new URL("../functions/package.json", import.meta.url))("firebase-admin/firestore") as typeof import("firebase-admin/firestore");
import { beforeEach, describe, expect, it, vi } from "vitest";
import { storedAuditReadAllowed } from "../functions/src/audit/authority";
import { activityBounds, activityFingerprint, activityInput, decodeActivityCursor, matchesActivity } from "../functions/src/audit/activity-query";
import { projectActivity } from "../functions/src/audit/activity-projection";

const state = vi.hoisted(() => ({
  actor: { userId: "auditor-1", organizationId: "org-1", roleId: "auditor", branchIds: [], warehouseIds: [], authorizationVersion: 1, storedAuditReadAllowed: true },
  logs: [] as Array<{ id: string; data: Record<string, unknown> }>,
  users: {} as Record<string, Record<string, unknown>>, queries: [] as unknown[], lookups: [] as unknown[],
}));
vi.mock("../functions/src/config.js", () => ({ enforceAppCheck: true }));
vi.mock("../functions/src/auth/authorize.js", () => ({ requireAccess: async () => state.actor }));
vi.mock("../functions/src/admin.js", () => {
  const snap = (id: string, data: Record<string, unknown> | undefined) => ({ id, exists: Boolean(data), data: () => data, get: (field: string) => data?.[field] });
  const db = {
    doc: (path: string) => ({ path, get: async () => { const [collection, id] = path.split("/"); return snap(id!, collection === "users" ? state.users[id!] : state.logs.find(row => row.id === id)?.data); } }),
    collection: (name: string) => {
      const build = (filters: Array<[string, string, unknown]> = [], after?: string, limit = 100) => ({
        where: (field: string, op: string, value: unknown) => build([...filters, [field, op, value]], after, limit),
        orderBy: () => build(filters, after, limit), startAfter: (anchor: { id: string }) => build(filters, anchor.id, limit),
        limit: (value: number) => build(filters, after, value), doc: () => ({ id: "new-audit-id" }),
        get: async () => {
          state.queries.push({ name, filters, after, limit });
          let rows = state.logs.filter(row => filters.every(([field, op, value]) => {
            const actual = row.data[field];
            return op === "==" ? actual === value : op === ">=" ? Number(actual) >= Number(value) : Number(actual) < Number(value);
          }));
          rows = rows.sort((a, b) => Number(b.data.createdAt) - Number(a.data.createdAt) || b.id.localeCompare(a.id));
          if (after) rows = rows.slice(rows.findIndex(row => row.id === after) + 1);
          const docs = rows.slice(0, limit).map(row => snap(row.id, row.data)); return { docs, empty: !docs.length, size: docs.length };
        },
      }); return build();
    },
    getAll: async (...args: Array<{ path?: string; fieldMask?: string[] }>) => {
      state.lookups.push(args); return args.filter(arg => arg.path).map(arg => { const id = arg.path!.split("/")[1]!; return snap(id, state.users[id]); });
    },
  }; return { db };
});
import { getUserActivity } from "../functions/src/callable/user-activity";
import { withRecordActors } from "../functions/src/audit/record-actors";
import { writeAuditLog } from "../functions/src/audit/write-audit-log";
const input = () => activityInput.parse({ fromDate: "2026-10-01", toDate: "2026-10-31" });
const run = (data: object) => (getUserActivity.run as unknown as (request: { data: object }) => Promise<{ rows: Array<ReturnType<typeof projectActivity>>; nextCursor: string | null; scanned: number; scanLimited: boolean }>)({ data });
const event = (n: number, extra = {}) => ({ id: `event-${String(n).padStart(5, "0")}`, data: { organizationId: "org-1", actorUserId: "user-1", action: "sale.completed", entityType: "sale", entityId: `sale-${n}`, createdAt: Timestamp.fromMillis(Date.parse("2026-10-20T12:00:00Z") - n * 1000), after: { saleNumber: `INV-${n}` }, ...extra } });
beforeEach(() => { state.logs = []; state.users = {}; state.queries = []; state.lookups = []; state.actor.storedAuditReadAllowed = true; state.actor.authorizationVersion = 1; });

describe("stored audit authority", () => {
  const base = { status: "active", roleId: "auditor" };
  it("retains legacy and custom auditor bases, while rejecting admin permission shortcuts", () => {
    for (const row of [base, { ...base, roleIds: ["auditor"], customRoleIds: ["custom"], effectivePermissions: ["audit.read"] }, { ...base, roleId: "system_administrator" }]) expect(storedAuditReadAllowed(row)).toBe(true);
    for (const change of [{ roleIds: [] }, { roleIds: null }, { effectivePermissions: [] }, { effectivePermissions: null }, { status: "suspended" }, { authDisabled: true }, { roleId: "operations_administrator", effectivePermissions: ["audit.read"] }, { roleId: "system_administrator", effectivePermissions: [] }]) expect(storedAuditReadAllowed({ ...base, ...change })).toBe(false);
  });
});
describe("activity dates, projection and cursors", () => {
  it("uses Lagos day boundaries and validates ordered calendar dates", () => {
    expect(activityBounds(input())).toEqual({ from: Date.parse("2026-09-30T23:00:00Z"), until: Date.parse("2026-10-31T23:00:00Z") });
    for (const change of [{ fromDate: "2026-02-30" }, { toDate: "2026-09-01" }, { fromDate: "2020-01-01" }, { pageSize: 500 }]) expect(activityInput.safeParse({ ...input(), ...change }).success).toBe(false);
    expect(activityInput.safeParse({ fromDate: "2024-02-29", toDate: "2024-02-29" }).success).toBe(true);
    expect(activityInput.safeParse({ ...input(), actorUserId: "connector:device-1" }).success).toBe(true);
    expect(activityInput.safeParse({ ...input(), actorUserId: "users/other" }).success).toBe(false);
  });
  it("projects only whitelisted evidence and identifies current versus historical names", () => {
    const raw = event(1, { password: "secret", before: { token: "secret" }, actorDisplayName: "Original", locationEvidence: { branchId: "branch-1", apiKey: "secret" } }).data;
    const projected = projectActivity("id", raw, "Renamed");
    expect(projected.actorName).toBe("Original"); expect(projected.actorNameEvidence).toBe("recorded_snapshot"); expect(projected.location).toEqual({ branchId: "branch-1" });
    expect(JSON.stringify(projected)).not.toContain("secret");
    expect(projectActivity("id", event(1).data, "Renamed").actorNameEvidence).toBe("current_name");
    expect(projectActivity("id", event(1).data).actorNameEvidence).toBe("uid_only");
    expect(matchesActivity(raw, { ...input(), reference: "inv-1", module: "sale", action: "sale.completed", entityType: "sale" })).toBe(true);
    expect(matchesActivity(raw, { ...input(), reference: "secret" })).toBe(false);
  });
});
describe("bounded callable reader", () => {
  it("denies unauthorized readers before touching audit data or names", async () => {
    state.actor.storedAuditReadAllowed = false;
    await expect(run(input())).rejects.toMatchObject({ code: "permission-denied" });
    expect(state.queries).toHaveLength(0); expect(state.lookups).toHaveLength(0);
  });
  it("returns only its tenant and selected actor, and binds cursors to all filters and authority", async () => {
    state.logs = [...Array.from({ length: 40 }, (_, n) => event(n)), event(100, { organizationId: "other" }), event(101, { actorUserId: "other" })];
    state.users = { "user-1": { organizationId: "org-1", displayName: "Current", email: "private" } };
    const filters = { ...input(), actorUserId: "user-1" };
    const first = await run(filters); expect(first.rows).toHaveLength(25); expect(first.rows[0]?.actorName).toBe("Current");
    const second = await run({ ...filters, cursor: first.nextCursor }); expect(second.rows).toHaveLength(15); expect(second.nextCursor).toBeNull();
    expect(new Set([...first.rows, ...second.rows].map(row => row.id)).size).toBe(40);
    for (const change of [{ actorUserId: "other" }, { action: "sale.other" }, { module: "other" }, { entityType: "other" }, { reference: "other" }, { toDate: "2026-10-30" }, { pageSize: 50 }]) await expect(run({ ...filters, ...change, cursor: first.nextCursor })).rejects.toMatchObject({ code: "invalid-argument" });
    state.actor.authorizationVersion = 2;
    await expect(run({ ...filters, cursor: first.nextCursor })).rejects.toMatchObject({ code: "invalid-argument" });
    expect(() => decodeActivityCursor("bad", activityFingerprint(state.actor, input()))).toThrow();
  });
  it("continues after an empty 1,000-event scan without falsely claiming complete history", async () => {
    state.logs = Array.from({ length: 1005 }, (_, n) => event(n, { action: n >= 1000 ? "user.created" : "sale.completed" }));
    const first = await run({ ...input(), action: "user.created" });
    expect(first.rows).toHaveLength(0); expect(first.scanned).toBe(1000); expect(first.scanLimited).toBe(true); expect(first.nextCursor).toBeTruthy();
    const second = await run({ ...input(), action: "user.created", cursor: first.nextCursor });
    expect(second.rows).toHaveLength(5); expect(second.nextCursor).toBeNull();
  });
  it("rejects a cursor whose anchor was removed, moved across tenants or has another timestamp", async () => {
    state.logs = Array.from({ length: 30 }, (_, n) => event(n));
    const first = await run(input()); const anchor = state.logs.find(row => row.id === first.rows.at(-1)?.id)!;
    anchor.data.organizationId = "other"; await expect(run({ ...input(), cursor: first.nextCursor })).rejects.toMatchObject({ code: "invalid-argument" });
    anchor.data.organizationId = "org-1"; anchor.data.createdAt = Timestamp.now(); await expect(run({ ...input(), cursor: first.nextCursor })).rejects.toMatchObject({ code: "invalid-argument" });
    state.logs = state.logs.filter(row => row !== anchor); await expect(run({ ...input(), cursor: first.nextCursor })).rejects.toMatchObject({ code: "invalid-argument" });
  });
});
describe("record attribution and immutable event snapshots", () => {
  it("looks up only record actors and exposes no unrelated or cross-tenant user fields", async () => {
    state.users = { creator: { organizationId: "org-1", displayName: "Creator", email: "private" }, approver: { organizationId: "other", displayName: "Foreign" } };
    const [row] = await withRecordActors("org-1", [{ id: "invoice", createdBy: "creator", approvedBy: "approver", assignedEmployeeId: "employee-not-user" }]);
    expect(row?.actorLabels).toEqual({ createdBy: { userId: "creator", currentName: "Creator" }, approvedBy: { userId: "approver", currentName: null } });
    expect(JSON.stringify(row)).not.toContain("Foreign"); expect(JSON.stringify(row)).not.toContain("private");
    expect(JSON.stringify(state.lookups)).not.toContain("users/employee-not-user");
  });
  it("caps name lookups and leaves unresolvable names as truthful UIDs", async () => {
    const rows = await withRecordActors("org-1", Array.from({ length: 210 }, (_, n) => ({ id: `record-${n}`, createdBy: `user-${n}` })));
    expect(rows).toHaveLength(210); expect((state.lookups[0] as unknown[]).length).toBe(201); expect(rows[209]?.actorLabels.createdBy?.currentName).toBeNull();
  });
  it("pins actor and tenant metadata even if an untyped event attempts to spoof them", () => {
    const create = vi.fn();
    writeAuditLog({ create } as never, { ...state.actor, roleId: "auditor", displayName: "Trusted" }, { action: "sale.completed", entityType: "sale", entityId: "id", correlationId: "trace", sourceFunction: "completeSale", after: { branchId: "branch-1" }, organizationId: "other", actorUserId: "spoof", actorDisplayName: "Spoofed", createdAt: "old" } as never);
    const record = create.mock.calls[0]![1];
    expect(record.organizationId).toBe("org-1"); expect(record.actorUserId).toBe("auditor-1"); expect(record.actorDisplayName).toBe("Trusted"); expect(record.locationEvidence).toEqual({ branchId: "branch-1" }); expect(record.createdAt).not.toBe("old");
    expect(state.lookups).toHaveLength(0);
  });
});

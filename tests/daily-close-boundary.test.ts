import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it, vi } from "vitest";
vi.mock("../functions/src/admin.js", () => ({ db: { collection: (name: string) => ({ name, where() { return this; }, orderBy() { return this; }, limit() { return this; } }) } }));
import { dailyBounds, dailyEvidence } from "../functions/src/accounting/daily-close";
describe("daily close exclusive Nigerian midnight", () => {
  it("includes the final nanosecond, excludes next midnight and retains exact timestamps in evidence", async () => {
    const { start, end } = dailyBounds("2026-10-17");
    expect(new Date(start.toMillis()).toISOString()).toBe("2026-10-16T23:00:00.000Z");
    const last = new (end.constructor as typeof Timestamp)(end.seconds - 1, 999_999_999);
    const opening = new (start.constructor as typeof Timestamp)(start.seconds - 1, 999_999_999);
    const doc = (id: string, data: Record<string, unknown>) => ({ id, updateTime: end, get: (key: string) => data[key] });
    const cash = [doc("opening", { effectiveAt: opening, debitMinor: 50, creditMinor: 0 }), doc("last", { effectiveAt: last, debitMinor: 100, creditMinor: 0 }), doc("next", { effectiveAt: end, debitMinor: 999, creditMinor: 0 })];
    const reader = { get: async (query: { name: string }) => {
      const docs = query.name === "journalLines" ? cash : query.name === "posShifts"
        ? [doc("last-shift", { openedAt: last, closedAt: last, cashVarianceMinor: 0 }), doc("next-shift", { openedAt: end })] : [];
      return { docs, size: docs.length };
    } };
    const evidence = await dailyEvidence(reader as unknown as FirebaseFirestore.Transaction, "org", "store", "2026-10-17");
    expect(evidence.cash).toMatchObject({ openingMinor: 50, receiptsMinor: 100, closingMinor: 150, lineCount: 2 });
    expect(evidence.closedShiftCount).toBe(1); expect(evidence.openShiftCount).toBe(0);
  });
});

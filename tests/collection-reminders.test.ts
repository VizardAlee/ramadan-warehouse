import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { awaitingCollectionDays, COLLECTION_REMINDER_DAYS } from "../functions/src/notifications/collection-reminders";
const { Timestamp } = createRequire(new URL("../functions/package.json", import.meta.url))("firebase-admin/firestore");

describe("uncollected reservation age", () => {
  const now = new Date("2026-10-09T12:00:00Z");
  it("requires seven complete days and does not guess missing historical dates", () => {
    expect(COLLECTION_REMINDER_DAYS).toBe(7);
    expect(awaitingCollectionDays(Timestamp.fromDate(new Date("2026-10-02T12:00:00Z")), now)).toBe(7);
    expect(awaitingCollectionDays(Timestamp.fromDate(new Date("2026-10-02T12:00:01Z")), now)).toBe(6);
    expect(awaitingCollectionDays(Timestamp.fromDate(new Date("2026-10-10T12:00:00Z")), now)).toBe(0);
    expect(awaitingCollectionDays(null, now)).toBeNull();
    expect(awaitingCollectionDays("2026-10-01", now)).toBeNull();
  });
});

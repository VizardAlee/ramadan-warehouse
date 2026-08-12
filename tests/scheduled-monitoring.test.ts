import { describe, expect, it } from "vitest";
import { operationalNotificationId } from "../functions/src/transfers/scheduled-monitoring";

describe("scheduled monitoring idempotency", () => {
  it("reuses one notification identity for repeated daily runs", () => {
    const first = operationalNotificationId("org", "transfer.overdue_receipt", "t1", "2026-08-09");
    const repeated = operationalNotificationId("org", "transfer.overdue_receipt", "t1", "2026-08-09");
    expect(repeated).toBe(first);
    expect(operationalNotificationId("org", "transfer.overdue_receipt", "t1", "2026-08-10")).not.toBe(first);
  });
});

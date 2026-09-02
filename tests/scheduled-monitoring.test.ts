import { describe, expect, it } from "vitest";
import { scheduledJobReliability } from "../functions/src/jobs/schedule-options";
import { operationalNotificationId } from "../functions/src/transfers/scheduled-monitoring";

describe("scheduled job reliability", () => {
  it("retries transient failures while retaining scale-to-zero", () => {
    expect(scheduledJobReliability).toEqual({
      retryCount: 3,
      maxRetrySeconds: 600,
      minBackoffSeconds: 30,
      maxBackoffSeconds: 120,
      maxDoublings: 2,
      timeoutSeconds: 120,
      minInstances: 0,
    });
  });
});

describe("scheduled monitoring idempotency", () => {
  it("reuses one notification identity for repeated daily runs", () => {
    const first = operationalNotificationId("org", "transfer.overdue_receipt", "t1", "2026-08-09");
    const repeated = operationalNotificationId("org", "transfer.overdue_receipt", "t1", "2026-08-09");
    expect(repeated).toBe(first);
    expect(operationalNotificationId("org", "transfer.overdue_receipt", "t1", "2026-08-10")).not.toBe(first);
  });
});

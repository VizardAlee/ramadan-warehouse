import type { ScheduleOptions } from "firebase-functions/v2/scheduler";

/**
 * Scheduled jobs remain scale-to-zero, but tolerate a cold start or a transient
 * platform failure without losing the scheduled run.
 */
export const scheduledJobReliability = {
  retryCount: 3,
  maxRetrySeconds: 600,
  minBackoffSeconds: 30,
  maxBackoffSeconds: 120,
  maxDoublings: 2,
  timeoutSeconds: 120,
  minInstances: 0,
} satisfies Partial<ScheduleOptions>;

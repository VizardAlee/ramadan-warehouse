import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "../admin.js";
import { stableHttpsError } from "../errors/stable-errors.js";

export interface RateLimitDecision {
  allowed: boolean;
  count: number;
  limit: number;
  retryAfterSeconds: number;
}

export function evaluateFixedWindow(
  currentCount: number,
  limit: number,
  windowEndsAtMs: number,
  nowMs: number,
): RateLimitDecision {
  const count = currentCount + 1;
  return {
    allowed: count <= limit,
    count,
    limit,
    retryAfterSeconds: Math.max(1, Math.ceil((windowEndsAtMs - nowMs) / 1000)),
  };
}

export async function enforceRateLimit(input: {
  organizationId: string;
  userId: string;
  operation: string;
  limit: number;
  windowSeconds: number;
}): Promise<void> {
  const now = Date.now();
  const windowNumber = Math.floor(now / (input.windowSeconds * 1000));
  const id = [input.organizationId, input.userId, input.operation, windowNumber]
    .map((part) => encodeURIComponent(part))
    .join("__");
  const reference = db.doc(`rateLimits/${id}`);
  const decision = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const windowEndsAtMs = (windowNumber + 1) * input.windowSeconds * 1000;
    const result = evaluateFixedWindow(Number(snapshot.get("count") ?? 0), input.limit, windowEndsAtMs, now);
    if (result.allowed)
      transaction.set(reference, {
        organizationId: input.organizationId,
        userId: input.userId,
        operation: input.operation,
        count: result.count,
        windowNumber,
        expiresAt: Timestamp.fromMillis(windowEndsAtMs + input.windowSeconds * 1000),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    return result;
  });
  if (!decision.allowed)
    throw stableHttpsError("resource-exhausted", "RATE_LIMITED", `Too many ${input.operation} requests. Try again later.`, true);
}

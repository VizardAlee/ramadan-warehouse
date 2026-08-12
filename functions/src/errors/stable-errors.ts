import { HttpsError, type FunctionsErrorCode } from "firebase-functions/v2/https";

export const stableErrorCodes = [
  "AUTH_REQUIRED", "APP_CHECK_REQUIRED", "PERMISSION_DENIED", "ORGANIZATION_MISMATCH",
  "BRANCH_SCOPE_VIOLATION", "WAREHOUSE_SCOPE_VIOLATION", "OUTDATED_VERSION",
  "INSUFFICIENT_STOCK", "SERIAL_ALREADY_RESERVED", "RESERVATION_CONFLICT",
  "INVALID_STATE_TRANSITION", "DISPATCH_QUANTITY_EXCEEDED", "RECEIPT_QUANTITY_EXCEEDED",
  "UNRESOLVED_DISCREPANCY", "UNRECONCILED_COSTS", "IDEMPOTENCY_CONFLICT", "RATE_LIMITED",
] as const;
export type StableErrorCode = (typeof stableErrorCodes)[number];

export function stableHttpsError(
  transportCode: FunctionsErrorCode,
  stableCode: StableErrorCode,
  safeMessage: string,
  retryable = false,
): HttpsError {
  return new HttpsError(transportCode, safeMessage, { code: stableCode, retryable });
}

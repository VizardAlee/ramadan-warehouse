const messages: Record<string, string> = {
  "functions/unauthenticated": "Your session has expired. Sign in again.",
  "functions/permission-denied": "You do not have permission to perform this action.",
  "functions/invalid-argument": "Some submitted information is invalid. Review the form and try again.",
  "functions/failed-precondition": "This action is not available in the record's current state. Refresh and review it.",
  "functions/aborted": "The record changed while you were working. Refresh and try again.",
  "functions/already-exists": "This record already exists.",
  "functions/not-found": "The requested record could not be found.",
  "functions/resource-exhausted": "Too many requests were made. Wait briefly and try again.",
  "functions/unavailable": "The service is temporarily unavailable. Check your connection and try again.",
  "auth/invalid-credential": "The email address or password is incorrect.",
  "auth/too-many-requests": "Too many sign-in attempts. Wait briefly before trying again.",
  "auth/network-request-failed": "Sign-in could not reach the service. Check your connection and try again.",
  STALE_POS_PRICE: "An offline sale uses an outdated price. Review and refresh it before posting.",
  POS_STOCK_RECONCILIATION_REQUIRED: "An offline sale exceeds current branch stock. A manager must reconcile stock before posting it.",
};
export class UserFacingError extends Error { constructor(message: string, readonly diagnosticCode?: string) { super(message); this.name = "UserFacingError"; } }
export function toUserFacingError(error: unknown, fallback = "The operation could not be completed. Refresh and try again."): UserFacingError {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
  const details =
    typeof error === "object" &&
    error !== null &&
    "details" in error &&
    typeof error.details === "object" &&
    error.details !== null
      ? error.details
      : undefined;
  const operationCode =
    details && "code" in details && typeof details.code === "string"
      ? details.code
      : undefined;
  return new UserFacingError(
    (operationCode && messages[operationCode]) ??
      (code ? messages[code] : undefined) ??
      fallback,
    operationCode ?? code,
  );
}

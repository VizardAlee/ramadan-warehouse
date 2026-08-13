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
};
export class UserFacingError extends Error { constructor(message: string, readonly diagnosticCode?: string) { super(message); this.name = "UserFacingError"; } }
export function toUserFacingError(error: unknown, fallback = "The operation could not be completed. Refresh and try again."): UserFacingError {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
  return new UserFacingError(code ? messages[code] ?? fallback : fallback, code);
}

import { httpsCallable } from "firebase/functions";
import { getFirebaseServices } from "@/lib/firebase/client";
import { toUserFacingError } from "@/lib/firebase/user-facing-error";
import { readStoredOperatingContext } from "@/features/auth/operating-context";

export function sanitizeCallableInput<TInput extends object>(
  input: TInput,
): TInput {
  return sanitizeCallableValue(input) as TInput;
}

function sanitizeCallableValue(value: unknown): unknown {
  if (Array.isArray(value))
    return value
      .filter((item) => item !== undefined)
      .map((item) => sanitizeCallableValue(item));

  if (
    value !== null &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  )
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, sanitizeCallableValue(item)]),
    );

  return value;
}

function isOutdatedAuthorization(error: unknown) {
  if (typeof error !== "object" || error === null || !("details" in error))
    return false;
  const details = error.details;
  return (
    typeof details === "object" &&
    details !== null &&
    "code" in details &&
    details.code === "OUTDATED_VERSION"
  );
}

export async function callAdministration<TInput extends object, TResult>(name: string, input: TInput): Promise<TResult> {
  const callable = httpsCallable<TInput & { operatingContext?: ReturnType<typeof readStoredOperatingContext> }, TResult>(getFirebaseServices().functions, name);
  const operatingContext = readStoredOperatingContext();
  const sanitizedInput = sanitizeCallableInput({
    ...input,
    operatingContext: operatingContext ?? undefined,
  });
  try { return (await callable(sanitizedInput)).data; }
  catch (error) {
    const currentUser = getFirebaseServices().auth.currentUser;
    if (currentUser && isOutdatedAuthorization(error)) {
      try {
        await currentUser.getIdToken(true);
        return (await callable(sanitizedInput)).data;
      } catch (retryError) {
        throw toUserFacingError(retryError);
      }
    }
    throw toUserFacingError(error);
  }
}

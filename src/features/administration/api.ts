import { httpsCallable } from "firebase/functions";
import { getFirebaseServices } from "@/lib/firebase/client";
import { toUserFacingError } from "@/lib/firebase/user-facing-error";

export function sanitizeCallableInput<TInput extends object>(
  input: TInput,
): TInput {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as TInput;
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
  const callable = httpsCallable<TInput, TResult>(getFirebaseServices().functions, name);
  const sanitizedInput = sanitizeCallableInput(input);
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

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

export async function callAdministration<TInput extends object, TResult>(name: string, input: TInput): Promise<TResult> {
  const callable = httpsCallable<TInput, TResult>(getFirebaseServices().functions, name);
  try { return (await callable(sanitizeCallableInput(input))).data; }
  catch (error) { throw toUserFacingError(error); }
}

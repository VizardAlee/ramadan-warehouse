import { httpsCallable } from "firebase/functions";
import { getFirebaseServices } from "@/lib/firebase/client";

export async function callAdministration<TInput extends object, TResult>(name: string, input: TInput): Promise<TResult> {
  const callable = httpsCallable<TInput, TResult>(getFirebaseServices().functions, name);
  return (await callable(input)).data;
}

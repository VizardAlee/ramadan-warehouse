import { randomUUID } from "node:crypto";
import { HttpsError } from "firebase-functions/v2/https";
import type { ZodType } from "zod";

export function parseInput<T>(schema: ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new HttpsError("invalid-argument", "The submitted data is invalid.", { fields: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) });
  return parsed.data;
}
export function correlationId(): string { return randomUUID(); }

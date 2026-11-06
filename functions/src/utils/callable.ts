import { randomUUID } from "node:crypto";
import { HttpsError } from "firebase-functions/v2/https";
import type { ZodType } from "zod";

export function parseInput<T>(schema: ZodType<T>, input: unknown): T {
  // Scope fields are filled only when the endpoint declares them. Never add a
  // branch to unrelated master data or rewrite transfer counterparties.
  const value = scopedInput(schema, input);
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new HttpsError("invalid-argument", "The submitted data is invalid.", { fields: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) });
  return parsed.data;
}
export function scopedInput(schema: ZodType, input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const value = { ...input } as Record<string, unknown>;
  const context = value.operatingContext as { type?: unknown; id?: unknown } | undefined;
  const definition = unwrapSchema(schema) as unknown as { shape?: Record<string, unknown>; options?: Array<{ shape?: Record<string, { value?: unknown; values?: Set<unknown> }> }> };
  const shape = definition.shape ?? definition.options?.find(option => option.shape && Object.entries(option.shape).some(([key, field]) => (field.value !== undefined && field.value === value[key]) || field.values?.has(value[key])))?.shape;
  if (shape && context && (context.type === "branch" || context.type === "warehouse") && typeof context.id === "string" && context.id) {
    const field = context.type === "branch" ? "branchId" : "warehouseId";
    const other = context.type === "branch" ? "warehouseId" : "branchId";
    if (field in shape) {
      if ((value[field] && value[field] !== context.id) || value[other])
        throw new HttpsError("failed-precondition", "This action belongs to another operating location. Select that location before continuing.", { code: "OPERATING_CONTEXT_MISMATCH", retryable: false });
      value[field] = context.id;
    }
  }
  delete value.operatingContext;
  return value;
}
export function correlationId(): string { return randomUUID(); }

function unwrapSchema(schema: ZodType): ZodType {
  const pipe = schema as unknown as { in?: ZodType };
  return pipe.in ? unwrapSchema(pipe.in) : schema;
}

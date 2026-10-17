import { createHash } from "node:crypto";

/** Parsed business instructions only: omit transport metadata and undefined keys. */
export function requestFingerprint(value: unknown): string {
  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical)
    : item !== null && typeof item === "object" ? Object.fromEntries(Object.entries(item)
      .filter(([, field]) => field !== undefined).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, field]) => [key, canonical(field)])) : item;
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

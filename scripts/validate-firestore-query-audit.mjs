import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { queryCatalog, querySourceFingerprints } from "./firestore-query-catalog.mjs";

export const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function indexSignature(index) {
  const fields = index.fields.map((field) => ({ ...field }));
  if (fields.at(-1)?.fieldPath !== "__name__") fields.push({ fieldPath: "__name__", order: fields.at(-1)?.order ?? "ASCENDING" });
  return digest({ collectionGroup: index.collectionGroup, queryScope: index.queryScope, fields });
}
export function validateAudit(baseline, manifest, sources, catalog) {
  if (digest(sources) !== digest(baseline.sourceFingerprints)) throw new Error("Firestore query source changed: review the query catalog and rerun the live index audit before updating its baseline.");
  if (digest(catalog) !== baseline.catalogSha256) throw new Error("Firestore query catalog changed: rerun the live index audit before updating its baseline.");
  const available = new Set(manifest.indexes.map(indexSignature));
  if (!baseline.indexSignatures.every((signature) => available.has(signature))) throw new Error("An audited Firestore index was removed or changed: rerun the live index audit before updating its baseline.");
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  validateAudit(JSON.parse(readFileSync("scripts/firestore-query-audit-baseline.json", "utf8")), JSON.parse(readFileSync("firestore.indexes.json", "utf8")), querySourceFingerprints(), queryCatalog());
  console.log("Cross-section query audit baseline validation passed.");
}

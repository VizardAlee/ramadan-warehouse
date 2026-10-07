import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { queryCatalog, querySourceFingerprints } from "./firestore-query-catalog.mjs";

const project = process.argv[process.argv.indexOf("--project") + 1];
if (!process.argv.includes("--project") || project !== "ramadan-warehouse-staging") throw new Error("Specify --project ramadan-warehouse-staging explicitly. This command only explains read queries; it never deploys or writes business data.");
if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Live index verification cannot use the emulator (which does not enforce composite indexes).");
const output = process.argv.includes("--output") ? process.argv[process.argv.indexOf("--output") + 1] : null;
const require = createRequire(import.meta.url);
const auth = require("firebase-tools/lib/auth");
const { requireAuth } = require("firebase-tools/lib/requireAuth");
const { Client } = require("firebase-tools/lib/apiv2");
const protobuf = require("protobufjs");
// Wire fields from google/firestore/admin/v1/index.proto; no credentials in decoded output.
const Index = protobuf.parse(`syntax = "proto3"; message Index {
  string name = 1; int32 queryScope = 2;
  message Field { string fieldPath = 1; int32 order = 2; int32 arrayConfig = 3; }
  repeated Field fields = 3;
}`).root.lookupType("Index");
const options = { project, nonInteractive: true };
auth.setActiveAccount(options, auth.getProjectDefaultAccount(process.cwd()));
await requireAuth(options);
const client = new Client({ urlPrefix: "https://firestore.googleapis.com", apiVersion: "v1", auth: true });
const parent = `projects/${project}/databases/(default)/documents`;
const ops = { "==": "EQUAL", "!=": "NOT_EQUAL", ">=": "GREATER_THAN_OR_EQUAL", "<=": "LESS_THAN_OR_EQUAL", ">": "GREATER_THAN", "<": "LESS_THAN", in: "IN", "not-in": "NOT_IN", "array-contains": "ARRAY_CONTAINS" };
function value(field, second = false) {
  if (field === "active") return { booleanValue: true };
  if (field === "variance") return { integerValue: "0" };
  if (["createdAt", "effectiveAt", "recordedAt", "occurredAt", "collectedAt"].includes(field)) return { timestampValue: "2026-10-01T00:00:00Z" };
  if (["countDate", "transactionDate", "occurredOn"].includes(field)) return { stringValue: "2026-10-01" };
  return { stringValue: second ? "index-audit-second" : "index-audit-probe" };
}
function filter([field, op]) {
  if (!ops[op]) throw new Error(`Unsupported query operator: ${op}`);
  return { fieldFilter: { field: { fieldPath: field }, op: ops[op], value: ["in", "not-in"].includes(op)
    ? { arrayValue: { values: [value(field), value(field, true)] } } : value(field) } };
}
function suggestedIndex(message) {
  const encoded = message.match(/create_composite=([A-Za-z0-9_=-]+)/)?.[1];
  if (!encoded) return null;
  const decoded = Index.toObject(Index.decode(Buffer.from(encoded, "base64url")));
  const collectionGroup = decoded.name.match(/collectionGroups\/([^/]+)/)?.[1];
  if (!collectionGroup || ![1, 2].includes(decoded.queryScope)) throw new Error("Unrecognized suggested index scope");
  return { collectionGroup, queryScope: decoded.queryScope === 1 ? "COLLECTION" : "COLLECTION_GROUP", fields: decoded.fields.map((field) => field.arrayConfig
    ? { fieldPath: field.fieldPath, arrayConfig: "CONTAINS" }
    : { fieldPath: field.fieldPath, order: field.order === 2 ? "DESCENDING" : "ASCENDING" }) };
}
const catalog = queryCatalog(), findings = [], successful = [];
let next = 0, completed = 0;
async function worker() {
  while (next < catalog.length) {
    const shape = catalog[next++];
    const path = shape.parent ? `${parent}/${shape.parent}` : parent;
    const query = { from: [{ collectionId: shape.collection }],
      ...(shape.filters.length ? { where: { compositeFilter: { op: "AND", filters: shape.filters.map(filter) } } } : {}),
      ...(shape.order.length ? { orderBy: shape.order.map(([fieldPath, direction]) => ({ field: { fieldPath }, direction })) } : {}),
      ...(shape.sums === null ? { limit: 1 } : {}) };
    const aggregate = shape.sums === null ? null : { structuredQuery: query, aggregations: [{ alias: "count", count: {} }, ...shape.sums.map((fieldPath, index) => ({ alias: `sum${index}`, sum: { field: { fieldPath } } }))] };
    let failure;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await client.post(`${path}:${aggregate ? "runAggregationQuery" : "runQuery"}`, { ...(aggregate ? { structuredAggregationQuery: aggregate } : { structuredQuery: query }), explainOptions: { analyze: false } });
        if (!response.body.some((row) => row.explainMetrics?.planSummary)) throw new Error("No query plan returned");
        successful.push(shape); failure = null; break;
      } catch (error) {
        const body = error.context?.body;
        const detail = Array.isArray(body) ? body.find((row) => row.error)?.error : body?.error;
        let message = detail?.message ?? error.message;
        // Explain omits the creation link. Retry only the failed shape against
        // sentinel IDs (limit 1 for rows), to obtain Firestore's exact definition.
        if (detail?.status === "FAILED_PRECONDITION" && /no matching index/i.test(message)) {
          try {
            await client.post(`${path}:${aggregate ? "runAggregationQuery" : "runQuery"}`, aggregate ? { structuredAggregationQuery: aggregate } : { structuredQuery: query });
          } catch (diagnosticError) {
            const diagnosticBody = diagnosticError.context?.body;
            const diagnostic = Array.isArray(diagnosticBody) ? diagnosticBody.find((row) => row.error)?.error : diagnosticBody?.error;
            if (diagnostic?.message) message = diagnostic.message;
          }
        }
        failure = { shape, status: detail?.status ?? String(error.status ?? "ERROR"), message: message.split("https://")[0].trim(), suggestedIndex: suggestedIndex(message) };
        if (![429, 500, 502, 503, 504].includes(error.status) && !/Failed to make request/.test(message)) break;
      }
    }
    if (failure) findings.push(failure);
    completed++;
    if (completed % 50 === 0) console.log(`Explained ${completed}/${catalog.length}; ${findings.length} issues`);
  }
}
await Promise.all(Array.from({ length: 4 }, worker));
const missingIndexes = [...new Map(findings.filter((item) => item.suggestedIndex).map((item) => [JSON.stringify(item.suggestedIndex), item.suggestedIndex])).values()];
const report = { project, verifiedAt: new Date().toISOString(), mode: "planner-only (analyze=false), with sentinel-scope missing-index diagnostics; no mutations", total: catalog.length, passed: successful.length, failed: findings.length, missingIndexes, findings, sourceFingerprints: querySourceFingerprints() };
if (output) writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ total: report.total, passed: report.passed, failed: report.failed, missingIndexes: missingIndexes.length, ...(output ? { report: output } : { findings }) }));
if (findings.length) process.exitCode = 1;

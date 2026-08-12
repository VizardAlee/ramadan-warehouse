import { existsSync, readFileSync, writeFileSync } from "node:fs";
import https from "node:https";

const expectedProject = "ramadan-warehouse-staging";
const preservedOwnerEmail = "servicegurunigeria@gmail.com";
const confirmation = "RESET_SYNTHETIC_DATA_FOR_PRODUCTION_CONVERSION";
const execute = process.env.PRODUCTION_CONVERSION_EXECUTE === "true";
const reportPath = process.env.PRODUCTION_CONVERSION_REPORT ?? "/tmp/ramadan-warehouse-production-reset-report.json";
const tokenFile = process.env.PRODUCTION_CONVERSION_ACCESS_TOKEN_FILE;

if (process.env.PRODUCTION_CONVERSION_PROJECT_ID !== expectedProject) throw new Error("Exact production-conversion project confirmation is required.");
if (process.env.PRODUCTION_CONVERSION_CONFIRM !== confirmation) throw new Error("Exact production-conversion confirmation phrase is required.");
if (!tokenFile || !existsSync(tokenFile)) throw new Error("A local short-lived privileged access-token file is required.");
const accessToken = readFileSync(tokenFile, "utf8").trim();

const deletableCollections = new Set([
  "auditLogs", "branchRequestApprovals", "branchRequestEvents", "branchRequestItems", "branchRequestVersions", "branchRequests", "branches",
  "dispatchReceiptBalances", "idempotencyKeys", "integrationOutbox", "inventoryBalances", "inventoryCounters", "inventoryEntries",
  "inventoryLocations", "inventoryLots", "inventoryReconciliations", "inventoryTransactions", "notificationEvents", "organizationCodes",
  "organizationCounters", "organizationSkus", "organizations", "productCosts", "products", "rateLimits", "requestFulfilments", "serializedItems",
  "stockReservations", "transferApprovals", "transferCosts", "transferCounters", "transferDiscrepancies", "transferDiscrepancyItems",
  "transferDispatchCounters", "transferDispatches", "transferEvents", "transferItems", "transferPackageItems", "transferPackages",
  "transferPickItems", "transferPicks", "transferReceiptClaims", "transferReceiptCounters", "transferReceiptItems", "transferReceipts",
  "transferVersions", "transfers", "userEmails", "users", "warehouses",
]);

async function requestOnce(url, { method = "GET", body } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = https.request({ hostname: parsed.hostname, path: `${parsed.pathname}${parsed.search}`, method, family: 4, timeout: 20000,
      headers: { authorization: `Bearer ${accessToken}`, "x-goog-user-project": expectedProject, ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}) } }, (res) => {
      let data = ""; res.on("data", (chunk) => { data += chunk; }); res.on("end", () => {
        let parsedBody = {}; try { parsedBody = data ? JSON.parse(data) : {}; } catch {}
        if ((res.statusCode ?? 500) >= 200 && (res.statusCode ?? 500) < 300) resolve(parsedBody);
        else reject(new Error(`${method} ${parsed.hostname}${parsed.pathname}: HTTP ${res.statusCode} ${parsedBody.error?.message ?? ""}`));
      });
    });
    req.on("timeout", () => req.destroy(new Error(`Timeout: ${parsed.hostname}`))); req.on("error", reject); req.end(payload);
  });
}
async function request(url, options = {}) { let error; for (let attempt = 0; attempt < 3; attempt += 1) { try { return await requestOnce(url, options); } catch (caught) { error = caught; } } throw error; }

const firestoreBase = `https://firestore.googleapis.com/v1/projects/${expectedProject}/databases/(default)/documents`;
function decode(value) {
  if (!value) return undefined;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  return undefined;
}
async function collectionIds(parent = "") {
  let pageToken; const ids = [];
  do { const body = await request(`${firestoreBase}${parent ? `/${parent}` : ""}:listCollectionIds`, { method: "POST", body: { pageSize: 1000, pageToken } }); ids.push(...(body.collectionIds ?? [])); pageToken = body.nextPageToken; } while (pageToken);
  return ids.sort();
}
async function documents(path) {
  let pageToken; const docs = [];
  do { const url = new URL(`${firestoreBase}/${path}`); url.searchParams.set("pageSize", "1000"); if (pageToken) url.searchParams.set("pageToken", pageToken); const body = await request(url); docs.push(...(body.documents ?? [])); pageToken = body.nextPageToken; } while (pageToken);
  return docs;
}
async function recursiveDocuments(collectionPath) {
  return documents(collectionPath);
}
async function authUsers() {
  let nextPageToken; const users = [];
  do { const url = new URL(`https://identitytoolkit.googleapis.com/v1/projects/${expectedProject}/accounts:batchGet`); url.searchParams.set("maxResults", "1000"); if (nextPageToken) url.searchParams.set("nextPageToken", nextPageToken); const body = await request(url); users.push(...(body.users ?? [])); nextPageToken = body.nextPageToken; } while (nextPageToken);
  return users;
}

const topCollections = await collectionIds();
const unexpected = topCollections.filter((name) => name !== "system" && !deletableCollections.has(name));
if (unexpected.length) throw new Error(`Unexpected top-level collections require review: ${unexpected.join(", ")}`);
const docsByCollection = {};
for (const collection of topCollections) docsByCollection[collection] = await recursiveDocuments(collection);
const organizationDocs = docsByCollection.organizations ?? [];
if (organizationDocs.length !== 1 || decode(organizationDocs[0].fields?.code) !== "RWSTG") throw new Error("Active organization is not the approved synthetic RWSTG dataset.");
const productDocs = docsByCollection.products ?? [];
if (!productDocs.length || productDocs.some((document) => !String(decode(document.fields?.sku) ?? "").startsWith("STG-"))) throw new Error("Product catalog contains non-synthetic SKUs.");
const bootstrapDocs = (docsByCollection.system ?? []).filter((document) => document.name.endsWith("/system/bootstrap"));
if (bootstrapDocs.length !== 1 || decode(bootstrapDocs[0].fields?.completed) !== true) throw new Error("Expected completed synthetic bootstrap state was not found.");

const users = await authUsers();
const owner = users.find((user) => user.email?.toLowerCase() === preservedOwnerEmail);
if (!owner || owner.disabled || !owner.emailVerified) throw new Error("Verified enabled owner Auth identity was not found.");
const syntheticUsers = users.filter((user) => user.localId !== owner.localId);
if (syntheticUsers.some((user) => !user.email?.toLowerCase().endsWith("@staging.ramadan-warehouse.invalid"))) throw new Error("Unexpected non-owner Auth identities require review.");

const report = { projectId: expectedProject, mode: execute ? "execute" : "dry-run", startedAt: new Date().toISOString(),
  preservedOwner: { uid: owner.localId, email: owner.email, enabled: !owner.disabled, emailVerified: owner.emailVerified },
  syntheticAuthUsers: syntheticUsers.map((user) => ({ uid: user.localId, email: user.email })),
  before: { firestore: Object.fromEntries(Object.entries(docsByCollection).map(([name, docs]) => [name, docs.length])), authUsers: users.length },
  actions: { deleteCollections: [...deletableCollections].sort(), deleteSystemBootstrap: true, clearOwnerClaimsAndSessions: true, deleteSyntheticAuthUsers: syntheticUsers.length } };

if (execute) {
  const deleteNames = [...deletableCollections].flatMap((collection) => docsByCollection[collection] ?? []).map((document) => document.name);
  deleteNames.push(...bootstrapDocs.map((document) => document.name));
  for (let index = 0; index < deleteNames.length; index += 200) await request(`https://firestore.googleapis.com/v1/projects/${expectedProject}/databases/(default)/documents:batchWrite`, { method: "POST", body: { writes: deleteNames.slice(index, index + 200).map((name) => ({ delete: name })) } });
  for (const user of syntheticUsers) await request(`https://identitytoolkit.googleapis.com/v1/projects/${expectedProject}/accounts:delete`, { method: "POST", body: { localId: user.localId } });
  await request(`https://identitytoolkit.googleapis.com/v1/projects/${expectedProject}/accounts:update`, { method: "POST", body: { localId: owner.localId, customAttributes: "{}", validSince: String(Math.floor(Date.now() / 1000)) } });
  const afterCollections = await collectionIds(); const afterUsers = await authUsers();
  report.completedAt = new Date().toISOString(); report.after = { topLevelCollections: afterCollections, authUsers: afterUsers.length, authEmails: afterUsers.map((user) => user.email) };
  report.bootstrapReady = !afterCollections.includes("organizations") && !afterCollections.includes("users") && !afterCollections.includes("system") && afterUsers.length === 1 && afterUsers[0].localId === owner.localId;
}

writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ mode: report.mode, reportPath, firestoreDocuments: Object.values(report.before.firestore).reduce((sum, count) => sum + count, 0), authUsers: report.before.authUsers, syntheticAuthUsers: syntheticUsers.length, bootstrapReady: report.bootstrapReady ?? false }, null, 2));

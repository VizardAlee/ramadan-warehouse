import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { getApps, initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const projectId = "demo-ramadan-warehouse", organizationId = "tax-rules-test-org";
const adminApp = getApps().find(app => app.name === "tax-rules-tests") ?? initializeAdminApp({ projectId }, "tax-rules-tests");
const db = getFirestore(adminApp), auth = getAdminAuth(adminApp), apps: FirebaseApp[] = [];
function client(name: string) {
  const app = initializeApp({ projectId, apiKey: "demo", appId: name }, name); apps.push(app);
  const auth = getAuth(app); connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const functions = getFunctions(app, "us-central1"); connectFunctionsEmulator(functions, "127.0.0.1", 5001); return { auth, functions };
}
let accountant: ReturnType<typeof client>, restricted: ReturnType<typeof client>, ruleId = "";
async function actor(email: string, roleId: string) {
  const user = await auth.createUser({ email, password: "Password!234567" });
  await db.doc(`users/${user.uid}`).set({ uid: user.uid, organizationId, roleId, branchIds: [], warehouseIds: [], email, status: "active", authDisabled: false, authorizationVersion: 1, createdAt: FieldValue.serverTimestamp() });
  const result = client(email); await signInWithEmailAndPassword(result.auth, email, "Password!234567"); return result;
}
async function call<T = Record<string, unknown>>(data: Record<string, unknown>, target = accountant, name = "taxRuleAdministration") { return (await httpsCallable(target.functions, name)(data)).data as T; }
const definition = { taxType: "VAT", scopeKey: "standard", version: "test-2026-v1", title: "Emulator statutory fixture", effectiveFrom: "2026-01-01", effectiveTo: "2026-12-31", calculation: "flat_rate", basis: "taxable_supplies", rateBasisPoints: 750, applicability: "Fixture taxable supplies only", exemptions: "Exemptions reviewed separately", source: "https://nass.gov.ng/documents/download/11249", sourceReference: "Emulator fixture: section 147" };
const propose = (change = {}) => ({ action: "propose", definition: { ...definition, ...change }, reason: "Accountant proposes reviewed fixture", idempotencyKey: crypto.randomUUID() });
const review = (id: string, change = {}) => ({ action: "review", ruleId: id, decision: "approved", sourceVerified: true, reason: "Accountant verified statutory fixture", idempotencyKey: crypto.randomUUID(), ...change });
beforeAll(async () => {
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${projectId}/accounts`, { method: "DELETE" });
  await fetch(`http://127.0.0.1:8180/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: "DELETE" });
  await db.doc(`organizations/${organizationId}`).set({ name: "Tax test", status: "active" });
  accountant = await actor("tax-finance@example.test", "finance_officer"); restricted = await actor("tax-cashier@example.test", "sales_cashier");
});
afterAll(async () => Promise.all(apps.map(app => deleteApp(app))));
describe.sequential("trusted tax rule review", () => {
  it("creates an immutable draft once and requires explicit review before calculating", async () => {
    const input = propose(), results = await Promise.all([call<{ ruleId: string }>(input), call<{ ruleId: string }>(input)]);
    ruleId = results[0]!.ruleId; expect(results[1]!.ruleId).toBe(ruleId);
    expect((await db.doc(`taxRules/${ruleId}`).get()).get("status")).toBe("draft");
    await expect(call({ action: "preview", ruleId, transactionDate: "2026-10-09", baseMinor: 100000 })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await expect(call(propose())).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await expect(call(review(ruleId, { sourceVerified: false }))).rejects.toMatchObject({ code: "functions/failed-precondition" });
    const approval = review(ruleId); const responses = await Promise.all([call(approval), call(approval)]); expect(responses[0]).toEqual(responses[1]);
    expect(await call({ action: "preview", ruleId, transactionDate: "2026-10-09", baseMinor: 100000 })).toMatchObject({ ruleId, ruleVersion: definition.version, taxMinor: 7500, previewOnly: true });
    await expect(call(review(ruleId))).rejects.toMatchObject({ code: "functions/failed-precondition" });
    expect((await db.collection("auditLogs").where("entityId", "==", ruleId).get()).size).toBe(2);
    expect((await db.collection("journalEntries").get()).empty).toBe(true);
  });
  it("rejects overlap, permits adjacent new versions, and preserves the original calculation", async () => {
    const overlap = await call<{ ruleId: string }>(propose({ version: "overlap" }));
    await expect(call(review(overlap.ruleId))).rejects.toMatchObject({ code: "functions/failed-precondition" });
    const future = await call<{ ruleId: string }>(propose({ version: "future", effectiveFrom: "2027-01-01", effectiveTo: "2027-12-31", rateBasisPoints: 1000 }));
    await call(review(future.ruleId));
    expect(await call({ action: "preview", ruleId: future.ruleId, transactionDate: "2027-01-01", baseMinor: 100000 })).toMatchObject({ taxMinor: 10000 });
    expect(await call({ action: "preview", ruleId, transactionDate: "2026-12-31", baseMinor: 100000 })).toMatchObject({ taxMinor: 7500, ruleVersion: definition.version });
    await expect(call({ action: "preview", ruleId, transactionDate: "2027-01-01", baseMinor: 100000 })).rejects.toMatchObject({ code: "functions/failed-precondition" });
  });
  it("serializes competing approvals and keeps rejected versions immutable", async () => {
    const a = await call<{ ruleId: string }>(propose({ scopeKey: "competing", version: "a" })), b = await call<{ ruleId: string }>(propose({ scopeKey: "competing", version: "b" }));
    const results = await Promise.allSettled([call(review(a.ruleId)), call(review(b.ruleId))]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const rejected = await call<{ ruleId: string }>(propose({ scopeKey: "rejected", version: "a" }));
    const input = review(rejected.ruleId, { decision: "rejected", sourceVerified: false }); await call(input); expect(await call(input)).toMatchObject({ status: "rejected" });
    await expect(call(review(rejected.ruleId))).rejects.toMatchObject({ code: "functions/failed-precondition" });
  });
  it("enforces authorization, organization isolation and exact retry fingerprints", async () => {
    await expect(call(propose({ version: "restricted" }), restricted)).rejects.toMatchObject({ code: "functions/permission-denied" });
    await db.doc("taxRules/foreign-tax-rule").set({ organizationId: "foreign", ...definition, status: "approved", sourceVerified: true });
    await expect(call(review("foreign-tax-rule"))).rejects.toMatchObject({ code: "functions/not-found" });
    await expect(call({ action: "preview", ruleId: "foreign-tax-rule", transactionDate: "2026-10-09", baseMinor: 100 })).rejects.toMatchObject({ code: "functions/not-found" });
    const input = propose({ version: "retry" }); await call(input);
    await expect(call({ ...input, reason: "Different changed tax instructions" })).rejects.toMatchObject({ code: "functions/failed-precondition" });
  });
  it("pages the register and checks full-period coverage independently of its visible page", async () => {
    const batch = db.batch(); for (let i = 0; i < 30; i++) batch.set(db.doc(`taxRules/paged-rule-${String(i).padStart(3, "0")}`), { organizationId, ...definition, version: `paged-${i}`, scopeKey: "paged", status: "draft" }); await batch.commit();
    const input = { fromDate: "2026-01-01", toDate: "2026-12-31", rulePageSize: 25 };
    const first = await call<{ rules: Array<{ id: string }>; nextRuleCursorId: string; statutoryRuleReviewRequired: boolean }>(input, accountant, "getTaxWorkspace");
    expect(first.rules).toHaveLength(25); expect(first.statutoryRuleReviewRequired).toBe(false); expect(first.nextRuleCursorId).toBeTruthy();
    const next = await call<{ rules: Array<{ id: string }> }>({ ...input, ruleCursorId: first.nextRuleCursorId }, accountant, "getTaxWorkspace");
    expect(next.rules.length).toBeGreaterThan(0); expect(next.rules.some(rule => first.rules.some(previous => previous.id === rule.id))).toBe(false);
    expect(await call({ ...input, fromDate: "2025-12-31" }, accountant, "getTaxWorkspace")).toMatchObject({ statutoryRuleReviewRequired: true });
    await expect(call({ ...input, ruleCursorId: "foreign-tax-rule" }, accountant, "getTaxWorkspace")).rejects.toMatchObject({ code: "functions/invalid-argument" });
  });
});

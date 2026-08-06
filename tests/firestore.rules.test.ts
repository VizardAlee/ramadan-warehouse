import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterAll, afterEach, beforeAll, describe, it } from "vitest";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";

const require = createRequire(import.meta.url);
const { assertFails, assertSucceeds, initializeTestEnvironment } = require("@firebase/rules-unit-testing") as typeof import("@firebase/rules-unit-testing");

let environment: RulesTestEnvironment;

beforeAll(async () => {
  environment = await initializeTestEnvironment({ projectId: "demo-ramadan-warehouse", firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8180 } });
});
afterEach(() => environment.clearFirestore());
afterAll(() => environment.cleanup());

async function seed() {
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.doc("users/branch-user").set({ organizationId: "org-1", status: "active", roleIds: ["branch_requester"], branchIds: ["branch-1"], warehouseIds: [] });
    await db.doc("users/auditor").set({ organizationId: "org-1", status: "active", roleIds: ["auditor"], branchIds: [], warehouseIds: [] });
    await db.doc("branches/branch-1").set({ organizationId: "org-1", name: "Kaduna" });
    await db.doc("branches/branch-2").set({ organizationId: "org-1", name: "Kano" });
    await db.doc("branches/foreign-branch").set({ organizationId: "org-2", name: "Foreign" });
    await db.doc("auditLogs/audit-1").set({ organizationId: "org-1", action: "test" });
  });
}

describe("Firestore baseline rules", () => {
  it("allows a branch user to read only an assigned branch", async () => {
    await seed();
    const db = environment.authenticatedContext("branch-user").firestore();
    await assertSucceeds(db.doc("branches/branch-1").get());
    await assertFails(db.doc("branches/branch-2").get());
    await assertFails(db.doc("branches/foreign-branch").get());
  });

  it("prevents clients from modifying inventory and posted audit records", async () => {
    await seed();
    const branchDb = environment.authenticatedContext("branch-user").firestore();
    const auditorDb = environment.authenticatedContext("auditor").firestore();
    await assertFails(branchDb.doc("inventoryBalances/balance-1").set({ organizationId: "org-1", onHand: 10 }));
    await assertSucceeds(auditorDb.doc("auditLogs/audit-1").get());
    await assertFails(auditorDb.doc("auditLogs/audit-1").update({ action: "changed" }));
  });

  it("denies unauthenticated access", async () => {
    await seed();
    const db = environment.unauthenticatedContext().firestore();
    await assertFails(db.doc("branches/branch-1").get());
  });
});

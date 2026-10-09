import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterAll, afterEach, beforeAll, describe, it } from "vitest";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";

const require = createRequire(import.meta.url);
const { assertFails, assertSucceeds, initializeTestEnvironment } =
  require("@firebase/rules-unit-testing") as typeof import("@firebase/rules-unit-testing");

let environment: RulesTestEnvironment;

beforeAll(async () => {
  environment = await initializeTestEnvironment({
    projectId: "demo-ramadan-warehouse",
    ...(process.env.FIREBASE_STORAGE_EMULATOR_HOST ? { storage: { rules: readFileSync("storage.rules", "utf8"), host: "127.0.0.1", port: Number(process.env.FIREBASE_STORAGE_EMULATOR_HOST.split(":").at(-1)) } } : {}),
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: Number(process.env.FIRESTORE_EMULATOR_HOST?.split(":").at(-1) ?? 8180),
    },
  });
});
afterEach(() => environment.clearFirestore());
afterAll(() => environment.cleanup());

async function seed() {
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.doc("users/branch-user").set({
      organizationId: "org-1",
      status: "active",
      roleId: "branch_requester",
      branchIds: ["branch-1"],
      warehouseIds: [],
    });
    await db.doc("users/auditor").set({
      organizationId: "org-1",
      status: "active",
      roleId: "auditor",
      branchIds: [],
      warehouseIds: [],
    });
    await db.doc("users/admin").set({
      organizationId: "org-1",
      status: "active",
      roleId: "system_administrator",
      branchIds: [],
      warehouseIds: [],
    });
    await db.doc("users/branch-manager").set({
      organizationId: "org-1",
      status: "active",
      roleId: "branch_manager",
      branchIds: ["branch-1"],
      warehouseIds: [],
    });
    await db.doc("users/sales-cashier").set({
      organizationId: "org-1",
      status: "active",
      roleId: "sales_cashier",
      branchIds: ["branch-1"],
      warehouseIds: [],
    });
    await db.doc("users/warehouse-manager").set({
      organizationId: "org-1",
      status: "active",
      roleId: "warehouse_manager",
      branchIds: [],
      warehouseIds: ["warehouse-1"],
    });
    await db.doc("users/dual-manager").set({
      organizationId: "org-1",
      status: "active",
      roleId: "warehouse_manager",
      roleIds: ["warehouse_manager", "branch_manager"],
      branchIds: ["branch-1"],
      warehouseIds: ["warehouse-1"],
    });
    await db.doc("users/canonical-branch-user").set({
      organizationId: "org-1",
      status: "active",
      roleId: "system_administrator",
      roleIds: ["branch_requester"],
      branchIds: ["branch-1"],
      warehouseIds: [],
    });
    await db.doc("users/finance").set({
      organizationId: "org-1",
      status: "active",
      roleId: "finance_officer",
      branchIds: [],
      warehouseIds: [],
    });
    await db.doc("users/custom-branch-reader").set({
      organizationId: "org-1",
      status: "active",
      roleId: "branch_manager",
      roleIds: ["branch_manager"],
      directRoleIds: [],
      customRoleIds: ["custom-role-1"],
      effectivePermissions: ["products.read"],
      branchIds: ["branch-1"],
      warehouseIds: [],
    });
    await db.doc("users/foreign-user").set({
      organizationId: "org-2",
      status: "active",
      roleId: "branch_requester",
      branchIds: [],
      warehouseIds: [],
    });
    await db
      .doc("branches/branch-1")
      .set({ organizationId: "org-1", name: "Kaduna" });
    await db
      .doc("branches/branch-2")
      .set({ organizationId: "org-1", name: "Kano" });
    await db
      .doc("branches/foreign-branch")
      .set({ organizationId: "org-2", name: "Foreign" });
    await db
      .doc("warehouses/warehouse-1")
      .set({ organizationId: "org-1", name: "Main" });
    await db
      .doc("warehouses/foreign-warehouse")
      .set({ organizationId: "org-2", name: "Foreign" });
    await db
      .doc("auditLogs/audit-1")
      .set({ organizationId: "org-1", action: "test" });
    await db
      .doc("products/product-1")
      .set({ organizationId: "org-1", sku: "SKU-1", active: true });
    await db.doc("productCosts/product-1").set({
      organizationId: "org-1",
      productId: "product-1",
      defaultUnitCostMinor: 1000,
    });
    await db.doc("productSalesPrices/product-1").set({
      organizationId: "org-1",
      productId: "product-1",
      basePriceMinor: 2000,
      vatRateBasisPoints: 750,
      active: true,
    });
    for (const [id, branchId] of [
      ["sale-1", "branch-1"],
      ["sale-2", "branch-2"],
    ]) {
      await db.doc(`sales/${id}`).set({
        organizationId: "org-1",
        branchId,
        status: "completed",
      });
      await db.doc(`saleItems/${id}-item`).set({
        organizationId: "org-1",
        branchId,
        saleId: id,
      });
      await db.doc(`salePayments/${id}-payment`).set({
        organizationId: "org-1",
        branchId,
        saleId: id,
      });
      await db.doc(`salesReceipts/${id}-receipt`).set({
        organizationId: "org-1",
        branchId,
        saleId: id,
      });
      await db.doc(`posShifts/${id}-shift`).set({
        organizationId: "org-1",
        branchId,
        status: "open",
      });
      await db.doc(`saleReturns/${id}-return`).set({
        organizationId: "org-1",
        branchId,
        saleId: id,
        status: "submitted",
      });
      await db.doc(`saleCorrectionRequests/${id}-correction`).set({ organizationId: "org-1", branchId, status: "submitted" });
      await db.doc(`saleCorrectionEvidence/${id}-evidence`).set({ organizationId: "org-1", branchId });
      await db.doc(`aftersalesCases/${id}-service`).set({
        organizationId: "org-1",
        branchId,
        saleId: id,
        status: "open",
      });
      await db.doc(`aftersalesPayments/${id}-service-payment`).set({
        organizationId: "org-1",
        branchId,
        caseId: `${id}-service`,
      });
      await db.doc(`saleReturnItems/${id}-return-item`).set({
        organizationId: "org-1",
        branchId,
        saleId: id,
        returnId: `${id}-return`,
      });
      await db.doc(`salesCredits/${id}-credit`).set({
        organizationId: "org-1",
        branchId,
        status: "active",
      });
    }
    await db.doc("chartOfAccounts/account-1").set({
      organizationId: "org-1",
      code: "4000",
    });
    await db.doc("journalEntries/journal-1").set({
      organizationId: "org-1",
      branchId: "branch-1",
    });
    await db.doc("journalLines/journal-1-line").set({
      organizationId: "org-1",
      branchId: "branch-1",
    });
    await db.doc("customers/customer-1").set({
      organizationId: "org-1",
      customerNumber: "CUS-000001",
      name: "Approved Customer",
      active: true,
      creditStatus: "approved",
    });
    await db.doc("customerPayments/customer-payment-1").set({
      organizationId: "org-1",
      branchId: "branch-1",
      customerId: "customer-1",
    });
    await db.doc("customerAccountEntries/customer-entry-1").set({
      organizationId: "org-1",
      branchId: "branch-1",
      customerId: "customer-1",
    });
    await db.doc("suppliers/supplier-1").set({
      organizationId: "org-1",
      supplierNumber: "SUP-2026-000001",
      name: "Test Supplier",
      active: true,
    });
    await db.doc("purchaseOrders/purchase-1").set({
      organizationId: "org-1",
      warehouseId: "warehouse-1",
      supplierId: "supplier-1",
      status: "approved",
    });
    await db.doc("purchaseOrderItems/purchase-item-1").set({
      organizationId: "org-1",
      warehouseId: "warehouse-1",
      purchaseOrderId: "purchase-1",
    });
    await db.doc("supplierInvoices/supplier-invoice-1").set({
      organizationId: "org-1",
      warehouseId: "warehouse-1",
      supplierId: "supplier-1",
      status: "approved",
    });
    await db.doc("expenseCategories/expense-category-1").set({
      organizationId: "org-1",
      name: "Electricity",
      active: true,
    });
    await db.doc("expenses/branch-expense-1").set({
      organizationId: "org-1",
      branchId: "branch-1",
      status: "approved",
    });
    await db.doc("expenses/warehouse-expense-1").set({
      organizationId: "org-1",
      warehouseId: "warehouse-1",
      status: "approved",
    });
    await db.doc("expenses/organization-expense-1").set({
      organizationId: "org-1",
      status: "approved",
    });
    await db.doc("expensePayments/expense-payment-1").set({
      organizationId: "org-1",
      expenseId: "branch-expense-1",
    });
    await db.doc("bankAccounts/bank-account-1").set({
      organizationId: "org-1",
      bankName: "Access Bank",
      accountNumberLast4: "4321",
      ledgerAccountCode: "1030",
    });
    await db.doc("bankStatementTransactions/bank-transaction-1").set({
      organizationId: "org-1",
      bankAccountId: "bank-account-1",
      amountMinor: -20000,
      status: "matched",
    });
    await db.doc("bankReconciliations/bank-reconciliation-1").set({
      organizationId: "org-1",
      bankAccountId: "bank-account-1",
      status: "prepared",
    });
    await db.doc("accountingPeriods/accounting-period-1").set({
      organizationId: "org-1",
      periodKey: "2026-07",
      status: "prepared",
    });
    await db
      .doc("inventoryTransactions/branch-1-tx")
      .set({ organizationId: "org-1", branchId: "branch-1", status: "posted" });
    await db
      .doc("inventoryTransactions/branch-2-tx")
      .set({ organizationId: "org-1", branchId: "branch-2", status: "posted" });
    await db.doc("inventoryTransactions/warehouse-1-tx").set({
      organizationId: "org-1",
      warehouseId: "warehouse-1",
      status: "posted",
    });
    await db.doc("inventoryEntries/entry-1").set({
      organizationId: "org-1",
      branchId: "branch-1",
      productId: "product-1",
      unitCostMinor: 1000,
    });
    await db.doc("inventoryBalances/balance-1").set({
      organizationId: "org-1",
      branchId: "branch-1",
      productId: "product-1",
      averageUnitCostMinor: 1000,
    });
    for (const [id, branchId] of [
      ["request-1", "branch-1"],
      ["request-2", "branch-2"],
    ]) {
      await db.doc(`branchRequests/${id}`).set({
        organizationId: "org-1",
        branchId,
        status: "submitted",
        totalFulfilledQuantity: 0,
      });
      await db.doc(`branchRequestItems/${id}-item`).set({
        organizationId: "org-1",
        requestId: id,
        branchId,
        productId: "product-1",
        requestedQuantity: 1,
        fulfilledQuantity: 0,
      });
      await db
        .doc(`branchRequestVersions/${id}-v1`)
        .set({ organizationId: "org-1", requestId: id, branchId, version: 1 });
      await db.doc(`branchRequestEvents/${id}-event`).set({
        organizationId: "org-1",
        requestId: id,
        branchId,
        eventType: "submitted",
      });
      await db.doc(`branchRequestComments/${id}-branch-comment`).set({
        organizationId: "org-1",
        requestId: id,
        branchId,
        visibility: "branch",
        comment: "Visible",
      });
      await db.doc(`branchRequestComments/${id}-internal-comment`).set({
        organizationId: "org-1",
        requestId: id,
        branchId,
        visibility: "internal",
        comment: "Internal",
      });
    }
    await db.doc("branchRequestApprovals/request-1-approval").set({
      organizationId: "org-1",
      requestId: "request-1",
      branchId: "branch-1",
      decision: "approved",
    });
    for (const [id, branchId] of [
      ["transfer-1", "branch-1"],
      ["transfer-2", "branch-2"],
    ]) {
      await db
        .doc(`transfers/${id}`)
        .set({
          organizationId: "org-1",
          originWarehouseId: "warehouse-1",
          destinationBranchId: branchId,
          status: "dispatched",
          estimatedCostMinor: 1000,
        });
      await db
        .doc(`transferItems/${id}-item`)
        .set({
          organizationId: "org-1",
          transferId: id,
          productId: "product-1",
          approvedQuantity: 1,
        });
      await db
        .doc(`transferEvents/${id}-event`)
        .set({
          organizationId: "org-1",
          transferId: id,
          eventType: "dispatched",
        });
      await db
        .doc(`transferDispatches/${id}-dispatch`)
        .set({ organizationId: "org-1", transferId: id, status: "in_transit" });
    }
    await db
      .doc("transferCosts/transfer-1-cost")
      .set({
        organizationId: "org-1",
        transferId: "transfer-1",
        actualAmountMinor: 1000,
        status: "incurred",
      });
    await db
      .doc("stockReservations/transfer-1-reservation")
      .set({
        organizationId: "org-1",
        transferId: "transfer-1",
        status: "active",
      });
  });
}

describe("Firestore baseline rules", () => {
  it("keeps sale serial ownership server-only even for privileged clients", async () => {
    await seed();
    await environment.withSecurityRulesDisabled(async context => {
      await context.firestore().doc("serializedItems/reserved-unit").set({ organizationId: "org-1", branchId: "branch-1", currentLocationId: "location-1", status: "reserved", active: true, reservedSaleId: "sale-1", reservedSaleItemId: "item-1" });
    });
    for (const uid of ["admin", "branch-manager", "sales-cashier"]) {
      const db = environment.authenticatedContext(uid).firestore();
      await assertFails(db.doc("serializedItems/reserved-unit").update({ status: "at_branch", reservedSaleId: null }));
      await assertFails(db.doc("serializedItems/reserved-unit").delete());
      await assertFails(db.doc("serializedItems/new-unit").set({ organizationId: "org-1", status: "at_branch", active: true }));
    }
  });
  it.skipIf(!process.env.FIREBASE_STORAGE_EMULATOR_HOST)("denies direct collection photo metadata and object access even to administrators", async () => {
    await seed();
    await environment.withSecurityRulesDisabled(async context => {
      await context.firestore().doc("saleCollectionEvidence/photo-1").set({ organizationId: "org-1", branchId: "branch-1", status: "linked" });
      for (const parent of ["aftersalesCases/case-1", "supplierReturns/return-1", "purchaseReceipts/receipt-1", "saleReturns/customer-return-1"])
        await context.firestore().doc(`${parent}/evidence/photo-1`).set({ organizationId: "org-1", branchId: "branch-1", serialNumber: "SN-1" });
    });
    for (const uid of ["admin", "branch-manager", "sales-cashier"]) {
      const context = environment.authenticatedContext(uid);
      await assertFails(context.firestore().doc("saleCollectionEvidence/photo-1").get());
      await assertFails(context.firestore().doc("saleCollectionEvidence/photo-1").update({ status: "uploaded" }));
      await assertFails(context.firestore().doc("saleCollectionEvidence/new-photo").set({ organizationId: "org-1" }));
      const object = context.storage("gs://demo-ramadan-warehouse.appspot.com").ref("collection-evidence/org-1/sale-1/photo.png");
      await assertFails(Promise.resolve(object.put(new Uint8Array([1, 2, 3]), { contentType: "image/png" })));
      await assertFails(object.getDownloadURL());
      for (const parent of ["aftersalesCases/case-1", "supplierReturns/return-1", "purchaseReceipts/receipt-1", "saleReturns/customer-return-1"]) {
        const metadata = context.firestore().doc(`${parent}/evidence/photo-1`);
        await assertFails(metadata.get());
        await assertFails(metadata.set({ organizationId: "org-1", serialNumber: "SN-1" }));
        await assertFails(metadata.delete());
      }
      const privateObject = context.storage("gs://demo-ramadan-warehouse.appspot.com").ref("operational-evidence/org-1/aftersales/case-1/photo.png");
      await assertFails(Promise.resolve(privateObject.put(new Uint8Array([1, 2, 3]), { contentType: "image/png" })));
      await assertFails(privateObject.getDownloadURL());
    }
  });

  it("keeps aftersales cases and payments branch-scoped and server-write-only", async () => {
    await seed();
    const branchDb = environment.authenticatedContext("branch-manager").firestore();
    const adminDb = environment.authenticatedContext("admin").firestore();
    await assertSucceeds(branchDb.doc("aftersalesCases/sale-1-service").get());
    await assertSucceeds(branchDb.doc("aftersalesPayments/sale-1-service-payment").get());
    await assertFails(branchDb.doc("aftersalesCases/sale-2-service").get());
    await assertFails(branchDb.doc("aftersalesPayments/sale-2-service-payment").get());
    await assertSucceeds(adminDb.doc("aftersalesCases/sale-2-service").get());
    await assertFails(adminDb.doc("aftersalesCases/sale-1-service").update({ status: "completed" }));
    await assertFails(adminDb.doc("aftersalesPayments/new-payment").set({ organizationId: "org-1", branchId: "branch-1" }));
  });
  it("limits accounting period evidence to authorized read-only roles", async () => {
    await seed();
    const adminDb = environment.authenticatedContext("admin").firestore();
    const financeDb = environment.authenticatedContext("finance").firestore();
    const auditorDb = environment.authenticatedContext("auditor").firestore();
    const branchDb = environment.authenticatedContext("branch-manager").firestore();
    await assertSucceeds(adminDb.doc("accountingPeriods/accounting-period-1").get());
    await assertSucceeds(financeDb.doc("accountingPeriods/accounting-period-1").get());
    await assertSucceeds(auditorDb.doc("accountingPeriods/accounting-period-1").get());
    await assertFails(branchDb.doc("accountingPeriods/accounting-period-1").get());
    await assertFails(financeDb.doc("accountingPeriods/accounting-period-1").update({ status: "closed" }));
  });
  it("allows a branch user to read only an assigned branch", async () => {
    await seed();
    const db = environment.authenticatedContext("branch-user").firestore();
    await assertSucceeds(db.doc("branches/branch-1").get());
    await assertFails(db.doc("branches/branch-2").get());
    await assertFails(db.doc("branches/foreign-branch").get());
  });

  it("prevents clients from modifying inventory and posted audit records", async () => {
    await seed();
    const branchDb = environment
      .authenticatedContext("branch-user")
      .firestore();
    const auditorDb = environment.authenticatedContext("auditor").firestore();
    await assertFails(
      branchDb
        .doc("inventoryBalances/balance-1")
        .set({ organizationId: "org-1", onHand: 10 }),
    );
    await assertSucceeds(auditorDb.doc("auditLogs/audit-1").get());
    await assertFails(
      auditorDb.doc("auditLogs/audit-1").update({ action: "changed" }),
    );
  });

  it("denies unauthenticated access", async () => {
    await seed();
    const db = environment.unauthenticatedContext().firestore();
    await assertFails(db.doc("branches/branch-1").get());
  });

  it("keeps simple transfer state and receipts callable-only, even for administrators", async () => {
    await seed();
    const client = environment.authenticatedContext("admin").firestore();
    for (const collection of ["stockTransfers", "stockTransferEvents", "stockTransferReceipts"]) {
      await assertFails(client.doc(`${collection}/example`).set({ organizationId: "org-1", status: "completed" }));
      await assertFails(client.doc(`${collection}/example`).get());
    }
  });
  it("prevents direct profile privilege escalation and bootstrap reads", async () => {
    await seed();
    const db = environment.authenticatedContext("admin").firestore();
    await assertFails(
      db.doc("users/branch-user").update({ roleId: "system_administrator" }),
    );
    await assertFails(db.doc("system/bootstrap").get());
  });
  it("keeps branch and warehouse data organization isolated", async () => {
    await seed();
    const db = environment.authenticatedContext("admin").firestore();
    await assertSucceeds(db.doc("branches/branch-1").get());
    await assertFails(db.doc("branches/foreign-branch").get());
    await assertSucceeds(db.doc("warehouses/warehouse-1").get());
    await assertFails(db.doc("warehouses/foreign-warehouse").get());
  });
  it("allows only organization-scoped profile queries for administrators", async () => {
    await seed();
    const db = environment.authenticatedContext("admin").firestore();
    await assertSucceeds(
      db.collection("users").where("organizationId", "==", "org-1").get(),
    );
    await assertFails(db.collection("users").get());
    await assertFails(
      db.collection("users").where("organizationId", "==", "org-2").get(),
    );
  });
  it("denies direct client writes to branch and warehouse master data", async () => {
    await seed();
    const db = environment.authenticatedContext("admin").firestore();
    await assertFails(
      db
        .doc("branches/new-branch")
        .set({ organizationId: "org-1", name: "New" }),
    );
    await assertFails(
      db.doc("warehouses/warehouse-1").update({ name: "Changed" }),
    );
  });
  it("enforces branch and warehouse inventory read scope", async () => {
    await seed();
    const branchDb = environment
      .authenticatedContext("branch-manager")
      .firestore();
    const warehouseDb = environment
      .authenticatedContext("warehouse-manager")
      .firestore();
    await assertSucceeds(
      branchDb.doc("inventoryTransactions/branch-1-tx").get(),
    );
    await assertFails(branchDb.doc("inventoryTransactions/branch-2-tx").get());
    await assertSucceeds(
      warehouseDb.doc("inventoryTransactions/warehouse-1-tx").get(),
    );
    await assertFails(
      warehouseDb.doc("inventoryTransactions/branch-1-tx").get(),
    );
  });
  it("unions branch and warehouse scope for a user with both manager roles", async () => {
    await seed();
    const db = environment.authenticatedContext("dual-manager").firestore();
    await assertSucceeds(db.doc("branches/branch-1").get());
    await assertSucceeds(db.doc("warehouses/warehouse-1").get());
    await assertSucceeds(db.doc("inventoryTransactions/branch-1-tx").get());
    await assertSucceeds(db.doc("inventoryTransactions/warehouse-1-tx").get());
    await assertFails(db.doc("inventoryTransactions/branch-2-tx").get());
  });
  it("does not grant a stale compatibility role when canonical roles exist", async () => {
    await seed();
    const db = environment.authenticatedContext("canonical-branch-user").firestore();
    await assertSucceeds(db.doc("branches/branch-1").get());
    await assertFails(db.doc("auditLogs/audit-1").get());
  });
  it("denies all direct ledger mutations and protects cost documents", async () => {
    await seed();
    const branchDb = environment
      .authenticatedContext("branch-manager")
      .firestore();
    const financeDb = environment.authenticatedContext("finance").firestore();
    await assertFails(branchDb.doc("productCosts/product-1").get());
    await assertSucceeds(financeDb.doc("productCosts/product-1").get());
    await assertFails(branchDb.doc("inventoryEntries/entry-1").get());
    await assertSucceeds(financeDb.doc("inventoryEntries/entry-1").get());
    await assertFails(
      financeDb.doc("inventoryEntries/entry-1").update({ unitCostMinor: 1 }),
    );
    await assertFails(
      financeDb
        .doc("inventoryBalances/balance-1")
        .update({ averageUnitCostMinor: 1 }),
    );
    await assertFails(
      financeDb.doc("inventoryTransactions/branch-1-tx").delete(),
    );
  });
  it("isolates branch requests and hides internal approval records", async () => {
    await seed();
    const branchDb = environment
      .authenticatedContext("branch-user")
      .firestore();
    const adminDb = environment.authenticatedContext("admin").firestore();
    await assertSucceeds(branchDb.doc("branchRequests/request-1").get());
    await assertFails(branchDb.doc("branchRequests/request-2").get());
    await assertSucceeds(
      branchDb.doc("branchRequestItems/request-1-item").get(),
    );
    await assertSucceeds(
      branchDb.doc("branchRequestVersions/request-1-v1").get(),
    );
    await assertSucceeds(
      branchDb.doc("branchRequestEvents/request-1-event").get(),
    );
    await assertSucceeds(
      branchDb.doc("branchRequestComments/request-1-branch-comment").get(),
    );
    await assertFails(
      branchDb.doc("branchRequestComments/request-1-internal-comment").get(),
    );
    await assertFails(
      branchDb.doc("branchRequestApprovals/request-1-approval").get(),
    );
    await assertSucceeds(
      adminDb.doc("branchRequestApprovals/request-1-approval").get(),
    );
  });
  it("denies every direct request workflow and history mutation", async () => {
    await seed();
    const branchDb = environment
      .authenticatedContext("branch-user")
      .firestore();
    const adminDb = environment.authenticatedContext("admin").firestore();
    await assertFails(
      branchDb
        .doc("branchRequests/request-1")
        .update({ status: "approved", totalFulfilledQuantity: 1 }),
    );
    await assertFails(
      branchDb
        .doc("branchRequestItems/request-1-item")
        .update({ fulfilledQuantity: 1 }),
    );
    await assertFails(
      adminDb
        .doc("branchRequestApprovals/request-1-approval")
        .update({ decision: "rejected" }),
    );
    await assertFails(
      adminDb.doc("branchRequestVersions/request-1-v1").delete(),
    );
    await assertFails(
      adminDb
        .doc("branchRequestEvents/request-1-event")
        .update({ eventType: "changed" }),
    );
    await assertFails(
      branchDb.doc("branchRequestComments/new-comment").set({
        organizationId: "org-1",
        branchId: "branch-1",
        visibility: "branch",
      }),
    );
  });
  it("scopes transfer operations and keeps cost-bearing headers sanitized through callables", async () => {
    await seed();
    const branchDb = environment
      .authenticatedContext("branch-user")
      .firestore();
    const warehouseDb = environment
      .authenticatedContext("warehouse-manager")
      .firestore();
    const financeDb = environment.authenticatedContext("finance").firestore();
    await assertFails(branchDb.doc("transfers/transfer-1").get());
    await assertSucceeds(branchDb.doc("transferItems/transfer-1-item").get());
    await assertFails(branchDb.doc("transferItems/transfer-2-item").get());
    await assertSucceeds(warehouseDb.doc("transfers/transfer-1").get());
    await assertSucceeds(financeDb.doc("transferCosts/transfer-1-cost").get());
    await assertFails(branchDb.doc("transferCosts/transfer-1-cost").get());
  });
  it("denies direct transfer, reservation, dispatch, receipt, cost, event, and approval writes", async () => {
    await seed();
    const adminDb = environment.authenticatedContext("admin").firestore();
    const branchDb = environment
      .authenticatedContext("branch-manager")
      .firestore();
    await assertFails(
      adminDb.doc("transfers/transfer-1").update({ status: "closed" }),
    );
    await assertFails(
      adminDb
        .doc("stockReservations/transfer-1-reservation")
        .update({ remainingQuantity: 0 }),
    );
    await assertFails(
      adminDb.doc("transferDispatches/transfer-1-dispatch").delete(),
    );
    await assertFails(
      branchDb
        .doc("transferReceipts/new")
        .set({ organizationId: "org-1", transferId: "transfer-1" }),
    );
    await assertFails(
      adminDb
        .doc("transferCosts/transfer-1-cost")
        .update({ actualAmountMinor: 1 }),
    );
    await assertFails(
      adminDb
        .doc("transferEvents/transfer-1-event")
        .update({ eventType: "closed" }),
    );
    await assertFails(
      adminDb
        .doc("transferApprovals/new")
        .set({ organizationId: "org-1", transferId: "transfer-1" }),
    );
  });
  it("scopes POS reads by branch and denies all direct sales and journal writes", async () => {
    await seed();
    const cashierDb = environment
      .authenticatedContext("sales-cashier")
      .firestore();
    const adminDb = environment.authenticatedContext("admin").firestore();
    const financeDb = environment.authenticatedContext("finance").firestore();
    await assertSucceeds(cashierDb.doc("products/product-1").get());
    await assertSucceeds(cashierDb.doc("productSalesPrices/product-1").get());
    await assertFails(cashierDb.doc("productSalesPrices/product-1").update({ wholesalePriceMinor: 1 }));
    await assertFails(adminDb.doc("productSalesPrices/product-1/versions/1").set({ organizationId: "org-1", basePriceMinor: 1 }));
    await assertFails(cashierDb.doc("productSalesPrices/product-1/versions/1").set({ organizationId: "org-1", basePriceMinor: 1 }));
    await assertSucceeds(cashierDb.doc("sales/sale-1").get());
    await environment.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc("saleCollections/collection-1").set({ organizationId: "org-1", branchId: "branch-1", saleId: "sale-1" });
      await context.firestore().doc("saleCollections/collection-2").set({ organizationId: "org-1", branchId: "branch-2", saleId: "sale-2" });
    });
    await assertFails(cashierDb.doc("saleCollections/collection-1").get());
    await assertSucceeds(adminDb.doc("saleCollections/collection-1").get());
    await assertFails(cashierDb.doc("saleCollections/collection-2").get());
    await assertFails(adminDb.doc("saleCollections/collection-1").update({ collector: "Changed history" }));
    await assertFails(cashierDb.doc("sales/sale-2").get());
    await assertSucceeds(cashierDb.doc("saleItems/sale-1-item").get());
    await assertSucceeds(cashierDb.doc("salePayments/sale-1-payment").get());
    await assertSucceeds(cashierDb.doc("salesReceipts/sale-1-receipt").get());
    await assertSucceeds(cashierDb.doc("posShifts/sale-1-shift").get());
    await assertSucceeds(cashierDb.doc("saleReturns/sale-1-return").get());
    await assertSucceeds(cashierDb.doc("saleCorrectionRequests/sale-1-correction").get());
    await assertFails(cashierDb.doc("saleCorrectionRequests/sale-2-correction").get());
    await assertFails(adminDb.doc("saleCorrectionRequests/sale-1-correction").update({ status: "completed" }));
    await assertFails(adminDb.doc("saleCorrectionRequests/forged").set({ organizationId: "org-1", branchId: "branch-1", status: "approved" }));
    await assertFails(adminDb.doc("saleCorrectionEvidence/sale-1-evidence").get());
    await assertFails(adminDb.doc("saleCorrectionEvidence/sale-1-evidence").delete());
    await assertSucceeds(cashierDb.doc("saleReturnItems/sale-1-return-item").get());
    await assertSucceeds(cashierDb.doc("salesCredits/sale-1-credit").get());
    await assertFails(cashierDb.doc("saleReturns/sale-2-return").get());
    await assertFails(cashierDb.doc("salesCredits/sale-2-credit").get());
    await assertFails(cashierDb.doc("journalEntries/journal-1").get());
    await assertSucceeds(financeDb.doc("journalEntries/journal-1").get());
    await assertSucceeds(adminDb.doc("chartOfAccounts/account-1").get());
    await assertSucceeds(adminDb.doc("customers/customer-1").get());
    await assertSucceeds(financeDb.doc("customers/customer-1").get());
    await assertFails(cashierDb.doc("customers/customer-1").get());
    await assertSucceeds(cashierDb.doc("customerPayments/customer-payment-1").get());
    await assertSucceeds(cashierDb.doc("customerAccountEntries/customer-entry-1").get());
    await assertFails(
      cashierDb.doc("sales/new-sale").set({
        organizationId: "org-1",
        branchId: "branch-1",
      }),
    );
    await assertFails(
      cashierDb.doc("saleReturns/new-return").set({
        organizationId: "org-1",
        branchId: "branch-1",
        status: "submitted",
      }),
    );
    await assertFails(
      adminDb.doc("salesCredits/sale-1-credit").update({ remainingAmountMinor: 0 }),
    );
    await assertFails(adminDb.doc("saleReturnItems/sale-1-return-item").update({ inspectionStatus: "completed", disposition: "resellable" }));
    await assertFails(adminDb.doc("saleReturnItems/sale-1-return-item").update({ aftersalesCaseLinks: [{ caseId: "forged-case", serialNumber: null, quantity: 1 }] }));
    await assertFails(adminDb.doc("saleReturnItems/sale-1-return-item").update({ heldDisposedQuantity: 1, heldDisposedCostMinor: 100 }));
    await assertFails(adminDb.doc("inventoryTransactions/branch-1-tx").update({ supplierSettledQuantity: 1, supplierSettledOriginalCostMinor: 100, supplierSettlementStatus: "settled" }));
    await assertFails(adminDb.doc("inventoryTransactions/branch-1-tx").update({ supplierReplacementQuantity: 1, latestReplacementTransactionId: "forged" }));
    await assertFails(adminDb.doc("inventoryTransactions/forged-replacement").set({ organizationId: "org-1", branchId: "branch-1", transactionType: "held_return_supplier_replacement", status: "posted", quantity: 1 }));
    await assertFails(adminDb.doc("inventoryTransactions/branch-1-tx/evidence/forged").set({ organizationId: "org-1", kind: "supplier_replacement" }));
    await assertFails(adminDb.doc("supplierReturns/forged-held-credit").set({ organizationId: "org-1", branchId: "branch-1", heldHandoverId: "branch-1-tx", status: "posted", grossAmountMinor: 100 }));
    await assertFails(adminDb.doc("aftersalesCases/forged-disposition").set({ organizationId: "org-1", branchId: "branch-1", heldDisposedQuantity: 1, recentDispositions: [{ outcome: "restock" }] }));
    await assertFails(adminDb.doc("saleRefunds/forged-exchange-refund").set({ organizationId: "org-1", branchId: "branch-1", amountMinor: 5000, status: "recorded" }));
    await assertFails(
      adminDb.doc("journalEntries/journal-1").update({ status: "void" }),
    );
    await assertFails(
      adminDb.doc("customers/customer-1").update({ creditLimitMinor: 999999 }),
    );
    await assertFails(adminDb.doc("customers/customer-1").update({ arrangements: [{ id: "forged", name: "Forged", outstandingBalanceMinor: 0, active: true }] }));
    await assertFails(adminDb.doc("customers/customer-1").update({ advanceBalances: { general: 99999 }, invoiceDebtByAccount: { general: 0 } }));
    await assertFails(adminDb.doc("sales/sale-1").update({ receivableOutstandingMinor: 0, receivableStatus: "settled" }));
    await assertFails(adminDb.doc("organizations/org-1/jobCursors/receivables").set({ saleId: "skip-invoices" }));
    await assertFails(adminDb.doc("customerPayments/forged").set({ organizationId: "org-1", customerId: "customer-1", amountMinor: 1, allocations: [{ accountId: "general", amountMinor: 1 }] }));
    await assertFails(adminDb.doc("customerPayments/forged-advance-refund").set({ organizationId: "org-1", branchId: "branch-1", customerId: "customer-1", purpose: "advance_refund", direction: "outflow", amountMinor: 1000, status: "recorded", bankAccountId: "bank-1" }));
    await assertFails(
      cashierDb.doc("customerPayments/new").set({
        organizationId: "org-1",
        branchId: "branch-1",
      }),
    );
  });
  it("scopes procurement reads and denies all direct purchasing and payable writes", async () => {
    await seed();
    const warehouseDb = environment.authenticatedContext("warehouse-manager").firestore();
    const branchDb = environment.authenticatedContext("branch-user").firestore();
    const financeDb = environment.authenticatedContext("finance").firestore();
    const adminDb = environment.authenticatedContext("admin").firestore();
    await assertSucceeds(warehouseDb.doc("suppliers/supplier-1").get());
    await assertSucceeds(warehouseDb.doc("purchaseOrders/purchase-1").get());
    await assertSucceeds(warehouseDb.doc("purchaseOrderItems/purchase-item-1").get());
    await assertFails(branchDb.doc("purchaseOrders/purchase-1").get());
    await assertSucceeds(financeDb.doc("supplierInvoices/supplier-invoice-1").get());
    await assertSucceeds(adminDb.doc("supplierInvoices/supplier-invoice-1").get());
    await assertFails(warehouseDb.doc("supplierInvoices/supplier-invoice-1").get());
    await assertFails(adminDb.doc("suppliers/new").set({ organizationId: "org-1", name: "Unsafe" }));
    await assertFails(warehouseDb.doc("purchaseOrders/purchase-1").update({ status: "received" }));
    await assertFails(financeDb.doc("supplierInvoices/supplier-invoice-1").update({ status: "paid" }));
  });
  it("scopes operating expenses and keeps approval and payment writes server-only", async () => {
    await seed();
    const branchDb = environment.authenticatedContext("branch-manager").firestore();
    const warehouseDb = environment.authenticatedContext("warehouse-manager").firestore();
    const financeDb = environment.authenticatedContext("finance").firestore();
    const adminDb = environment.authenticatedContext("admin").firestore();
    await assertSucceeds(branchDb.doc("expenseCategories/expense-category-1").get());
    await assertSucceeds(branchDb.doc("expenses/branch-expense-1").get());
    await assertFails(branchDb.doc("expenses/warehouse-expense-1").get());
    await assertFails(branchDb.doc("expenses/organization-expense-1").get());
    await assertSucceeds(warehouseDb.doc("expenses/warehouse-expense-1").get());
    await assertFails(warehouseDb.doc("expenses/branch-expense-1").get());
    await assertSucceeds(financeDb.doc("expenses/organization-expense-1").get());
    await assertSucceeds(financeDb.doc("expensePayments/expense-payment-1").get());
    await assertFails(branchDb.doc("expensePayments/expense-payment-1").get());
    await assertFails(adminDb.doc("expenses/new").set({ organizationId: "org-1", status: "approved" }));
    await assertFails(financeDb.doc("expenses/branch-expense-1").update({ status: "paid" }));
    await assertFails(financeDb.doc("expensePayments/new").set({ organizationId: "org-1", amountMinor: 1 }));
  });
  it("restricts bank evidence to finance roles and keeps reconciliation writes server-only", async () => {
    await seed();
    const branchDb = environment.authenticatedContext("branch-manager").firestore();
    const financeDb = environment.authenticatedContext("finance").firestore();
    const auditorDb = environment.authenticatedContext("auditor").firestore();
    const adminDb = environment.authenticatedContext("admin").firestore();
    for (const path of ["bankAccounts/bank-account-1", "bankStatementTransactions/bank-transaction-1", "bankReconciliations/bank-reconciliation-1"]) {
      await assertFails(branchDb.doc(path).get());
      await assertSucceeds(financeDb.doc(path).get());
      await assertSucceeds(auditorDb.doc(path).get());
    }
    await assertFails(adminDb.doc("bankAccounts/new").set({ organizationId: "org-1", ledgerAccountCode: "1031" }));
    await assertFails(financeDb.doc("bankStatementTransactions/bank-transaction-1").update({ status: "reconciled" }));
    await assertFails(adminDb.doc("bankReconciliations/bank-reconciliation-1").update({ status: "closed" }));
  });
  it("enforces a custom role's effective permissions despite its branch-manager scope", async () => {
    await seed();
    const custom = environment.authenticatedContext("custom-branch-reader").firestore();
    await assertSucceeds(custom.doc("products/product-1").get());
    await assertFails(custom.doc("sales/sale-1").get());
    await assertFails(custom.doc("customers/customer-1").get());
    await assertFails(custom.doc("expenses/branch-expense-1").get());
    await assertFails(custom.doc("products/product-1").update({ sku: "UNAUTHORIZED" }));
  });
  it("keeps inbox entries private and allows only the recipient to mark one read", async () => {
    await seed();
    await environment.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc("users/branch-manager/notifications/order-1").set({
        organizationId: "org-1",
        recipientId: "branch-manager",
        title: "Payment needs confirmation",
        occurredAt: new Date(),
        readAt: null,
      });
      await context.firestore().doc("users/branch-manager/notifications/order-2").set({
        organizationId: "org-1",
        recipientId: "branch-manager",
        title: "Another order",
        occurredAt: new Date(),
        readAt: null,
      });
    });
    const owner = environment.authenticatedContext("branch-manager").firestore();
    const other = environment.authenticatedContext("sales-cashier").firestore();
    const admin = environment.authenticatedContext("admin").firestore();
    const path = "users/branch-manager/notifications/order-1";
    await assertSucceeds(owner.doc(path).get());
    await assertSucceeds(owner.collection("users/branch-manager/notifications").where("organizationId", "==", "org-1").orderBy("occurredAt", "desc").limit(50).get());
    await assertFails(owner.collection("users/branch-manager/notifications").get());
    await assertFails(other.doc(path).get());
    await assertFails(admin.doc(path).get());
    await assertFails(owner.doc(path).set({ organizationId: "org-1", recipientId: "branch-manager" }));
    await assertFails(owner.doc(path).update({ title: "Changed" }));
    await assertFails(other.doc(path).update({ readAt: new Date() }));
    await assertSucceeds(owner.doc(path).update({ readAt: new Date() }));
    await assertFails(owner.doc(path).update({ readAt: new Date() }));
    const batch = owner.batch();
    batch.update(owner.doc("users/branch-manager/notifications/order-2"), { readAt: new Date() });
    await assertSucceeds(batch.commit());
    await assertFails(owner.doc("users/branch-manager/notifications/order-2").delete());
  });
  it("keeps push endpoints, employee records, salaries, attendance and daily-close evidence server-only", async () => {
    await seed();
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.doc("users/branch-manager/pushSubscriptions/device-1").set({ organizationId: "org-1", endpoint: "https://push.example/device" });
      await db.doc("employees/employee-1").set({ organizationId: "org-1", fullName: "Test Worker" });
      await db.doc("employeeCompensation/employee-1").set({ organizationId: "org-1", monthlySalaryMinor: 100_000 });
      await db.doc("attendanceEvents/event-1").set({ organizationId: "org-1", employeeId: "employee-1" });
      await db.doc("employeeActivityEvents/activity-1").set({ organizationId: "org-1", employeeId: "employee-1" });
      await db.doc("dailyCloses/day-1").set({ organizationId: "org-1", branchId: "branch-1", status: "signed" });
      await db.doc("dailyCloses/day-1/revisions/1").set({ organizationId: "org-1", version: 1 });
      await db.doc("dailyCloses/day-1/signOffs/1").set({ organizationId: "org-1", version: 1 });
      await db.doc("supplierReturns/return-1").set({ organizationId: "org-1", status: "posted" });
      await db.doc("supplierReturnCreditNoteLines/note-1").set({ organizationId: "org-1", returnId: "return-1" });
      await db.doc("taxRules/rule-1").set({ organizationId: "org-1", status: "approved" });
      await db.doc("taxRuleLocks/lock-1").set({ organizationId: "org-1" });
    });
    for (const identity of ["admin", "branch-manager", "finance", "foreign-user"]) {
      const db = environment.authenticatedContext(identity).firestore();
      for (const path of ["supplierReturns/return-1", "supplierReturnCreditNoteLines/note-1", "taxRules/rule-1", "taxRuleLocks/lock-1"]) {
        await assertFails(db.doc(path).get());
        await assertFails(db.doc(path).set({ organizationId: "org-1" }));
        await assertFails(db.doc(path).delete());
      }
      for (const path of ["users/branch-manager/pushSubscriptions/device-1", "employees/employee-1", "employeeCompensation/employee-1", "attendanceEvents/event-1", "employeeActivityEvents/activity-1", "dailyCloses/day-1", "dailyCloses/day-1/revisions/1", "dailyCloses/day-1/signOffs/1"]) {
        await assertFails(db.doc(path).get());
        await assertFails(db.doc(path).set({ organizationId: "org-1" }));
      }
    }
  });
});

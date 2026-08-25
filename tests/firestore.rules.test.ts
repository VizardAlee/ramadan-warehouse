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
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8180,
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
    await assertSucceeds(cashierDb.doc("sales/sale-1").get());
    await assertFails(cashierDb.doc("sales/sale-2").get());
    await assertSucceeds(cashierDb.doc("saleItems/sale-1-item").get());
    await assertSucceeds(cashierDb.doc("salePayments/sale-1-payment").get());
    await assertSucceeds(cashierDb.doc("salesReceipts/sale-1-receipt").get());
    await assertSucceeds(cashierDb.doc("posShifts/sale-1-shift").get());
    await assertSucceeds(cashierDb.doc("saleReturns/sale-1-return").get());
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
    await assertFails(
      adminDb.doc("journalEntries/journal-1").update({ status: "void" }),
    );
    await assertFails(
      adminDb.doc("customers/customer-1").update({ creditLimitMinor: 999999 }),
    );
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
});

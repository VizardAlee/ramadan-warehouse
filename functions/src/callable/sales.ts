import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import {
  hasRole,
  requireAccess,
  requireBranchScope,
  requirePermission,
} from "../auth/authorize.js";
import { enforceAppCheck } from "../config.js";
import {
  balanceDocumentId,
  issueCost,
  uniquenessDocumentId,
} from "../inventory/calculations.js";
import {
  assertBalancedJournal,
  assertPaymentsEqualTotal,
  calculateSale,
} from "../sales/calculations.js";
import { correlationId, parseInput } from "../utils/callable.js";
import {
  branchSalesPriceInput,
  closePosShiftInput,
  commitSaleInput,
  openPosShiftInput,
  posWorkspaceInput,
  salesPriceInput,
} from "../validation/sales.js";

const accountNames: Readonly<Record<string, string>> = {
  "1010": "Cash on hand",
  "1020": "Card clearing",
  "1030": "Bank transfer clearing",
  "1100": "Accounts receivable",
  "1200": "Inventory asset",
  "2100": "VAT payable",
  "2200": "Customer exchange credits",
  "4000": "Sales revenue",
  "5000": "Cost of goods sold",
};

const paymentAccount: Readonly<Record<string, string>> = {
  cash: "1010",
  card: "1020",
  bank_transfer: "1030",
  exchange_credit: "2200",
};

function clean(values: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(values).filter(
      ([, value]) => value !== undefined && value !== "",
    ),
  );
}

function branchPriceId(
  organizationId: string,
  branchId: string,
  productId: string,
) {
  return uniquenessDocumentId(
    organizationId,
    "branchSalesPrice",
    branchId,
    productId,
  );
}

async function activeBranchLocation(
  organizationId: string,
  branchId: string,
) {
  const result = await db
    .collection("inventoryLocations")
    .where("organizationId", "==", organizationId)
    .where("branchId", "==", branchId)
    .where("type", "==", "branch")
    .limit(5)
    .get();
  const active = result.docs.filter((document) => document.get("status") === "active");
  if (active.length !== 1)
    throw new HttpsError(
      "failed-precondition",
      "The branch requires exactly one active sales-stock location.",
    );
  return active[0]!;
}

export const saveProductSalesPrice = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "sales.price.base.manage");
    const input = parseInput(salesPriceInput, request.data);
    const product = db.doc(`products/${input.productId}`);
    const price = db.doc(`productSalesPrices/${input.productId}`);
    const operation = db.doc(
      `idempotencyKeys/${actor.organizationId}_saveProductSalesPrice_${input.idempotencyKey}`,
    );
    const cid = correlationId();
    await db.runTransaction(async (transaction) => {
      const [productSnapshot, current, previousOperation] = await transaction.getAll(
        product,
        price,
        operation,
      );
      if (previousOperation!.exists) return;
      if (
        !productSnapshot!.exists ||
        productSnapshot!.get("organizationId") !== actor.organizationId
      )
        throw new HttpsError("not-found", "Product not found.");
      const now = FieldValue.serverTimestamp();
      const version = Number(current!.get("version") ?? 0) + 1;
      transaction.set(price, {
        organizationId: actor.organizationId,
        productId: input.productId,
        sku: productSnapshot!.get("sku"),
        productName: productSnapshot!.get("name"),
        basePriceMinor: input.basePriceMinor,
        vatRateBasisPoints: input.vatRateBasisPoints,
        currency: "NGN",
        active: input.active,
        version,
        createdAt: current!.exists ? current!.get("createdAt") : now,
        createdBy: current!.exists ? current!.get("createdBy") : actor.userId,
        updatedAt: now,
        updatedBy: actor.userId,
      });
      transaction.create(operation, {
        organizationId: actor.organizationId,
        action: "saveProductSalesPrice",
        entityId: price.id,
        status: "completed",
        createdAt: now,
        createdBy: actor.userId,
      });
      writeAuditLog(transaction, actor, {
        action: `sales_price.${current!.exists ? "updated" : "created"}`,
        entityType: "productSalesPrice",
        entityId: price.id,
        correlationId: cid,
        sourceFunction: "saveProductSalesPrice",
        before: current!.exists
          ? {
              basePriceMinor: current!.get("basePriceMinor"),
              vatRateBasisPoints: current!.get("vatRateBasisPoints"),
              version: current!.get("version"),
            }
          : undefined,
        after: {
          basePriceMinor: input.basePriceMinor,
          vatRateBasisPoints: input.vatRateBasisPoints,
          active: input.active,
          version,
        },
      });
    });
    return { productId: input.productId, saved: true };
  },
);

export const saveBranchSalesPrice = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "sales.price.branch.manage");
    const input = parseInput(branchSalesPriceInput, request.data);
    requireBranchScope(actor, input.branchId);
    const branch = db.doc(`branches/${input.branchId}`);
    const product = db.doc(`products/${input.productId}`);
    const basePrice = db.doc(`productSalesPrices/${input.productId}`);
    const price = db.doc(
      `branchSalesPrices/${branchPriceId(actor.organizationId, input.branchId, input.productId)}`,
    );
    const operation = db.doc(
      `idempotencyKeys/${actor.organizationId}_saveBranchSalesPrice_${input.idempotencyKey}`,
    );
    const cid = correlationId();
    await db.runTransaction(async (transaction) => {
      const [branchSnapshot, productSnapshot, central, current, previousOperation] =
        await transaction.getAll(branch, product, basePrice, price, operation);
      if (previousOperation!.exists) return;
      if (
        !branchSnapshot!.exists ||
        branchSnapshot!.get("organizationId") !== actor.organizationId ||
        branchSnapshot!.get("status") !== "active"
      )
        throw new HttpsError("failed-precondition", "Branch is unavailable.");
      if (
        !productSnapshot!.exists ||
        productSnapshot!.get("organizationId") !== actor.organizationId ||
        productSnapshot!.get("active") !== true
      )
        throw new HttpsError("failed-precondition", "Product is unavailable.");
      if (
        !central!.exists ||
        central!.get("organizationId") !== actor.organizationId ||
        central!.get("active") !== true
      )
        throw new HttpsError(
          "failed-precondition",
          "Set the central base selling price before a branch price.",
        );
      const belowBase = input.sellingPriceMinor < Number(central!.get("basePriceMinor"));
      if (belowBase && !hasRole(actor, "system_administrator"))
        throw new HttpsError(
          "permission-denied",
          "A price below the central base price requires administrator approval.",
        );
      if (belowBase && !input.reason)
        throw new HttpsError(
          "invalid-argument",
          "Administrator approval below the base price requires a reason.",
        );
      const now = FieldValue.serverTimestamp();
      const version = Number(current!.get("version") ?? 0) + 1;
      transaction.set(price, {
        organizationId: actor.organizationId,
        branchId: input.branchId,
        productId: input.productId,
        sku: productSnapshot!.get("sku"),
        productName: productSnapshot!.get("name"),
        basePriceMinor: central!.get("basePriceMinor"),
        sellingPriceMinor: input.sellingPriceMinor,
        vatRateBasisPoints: central!.get("vatRateBasisPoints"),
        basePriceVersion: central!.get("version"),
        currency: "NGN",
        active: input.active,
        belowBaseApproved: belowBase,
        belowBaseApprovedBy: belowBase ? actor.userId : null,
        belowBaseApprovalReason: belowBase ? input.reason : null,
        version,
        createdAt: current!.exists ? current!.get("createdAt") : now,
        createdBy: current!.exists ? current!.get("createdBy") : actor.userId,
        updatedAt: now,
        updatedBy: actor.userId,
      });
      transaction.create(operation, {
        organizationId: actor.organizationId,
        action: "saveBranchSalesPrice",
        entityId: price.id,
        status: "completed",
        createdAt: now,
        createdBy: actor.userId,
      });
      writeAuditLog(transaction, actor, {
        action: belowBase
          ? "branch_sales_price.below_base_approved"
          : `branch_sales_price.${current!.exists ? "updated" : "created"}`,
        entityType: "branchSalesPrice",
        entityId: price.id,
        reason: input.reason,
        correlationId: cid,
        sourceFunction: "saveBranchSalesPrice",
        before: current!.exists
          ? { sellingPriceMinor: current!.get("sellingPriceMinor") }
          : undefined,
        after: {
          branchId: input.branchId,
          productId: input.productId,
          sellingPriceMinor: input.sellingPriceMinor,
          belowBaseApproved: belowBase,
          version,
        },
      });
    });
    return { branchPriceId: price.id, saved: true };
  },
);

export const getPosWorkspace = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    if (
      !hasRole(actor, "system_administrator") &&
      !hasRole(actor, "operations_administrator")
    )
      requirePermission(actor, "sales.read.own_branch");
    else requirePermission(actor, "sales.read.all");
    const input = parseInput(posWorkspaceInput, request.data);
    requireBranchScope(actor, input.branchId);
    const location = await activeBranchLocation(actor.organizationId, input.branchId);
    const [branch, products, prices, branchPrices, balances, shifts, customers, salesCredits] =
      await Promise.all([
        db.doc(`branches/${input.branchId}`).get(),
        db
          .collection("products")
          .where("organizationId", "==", actor.organizationId)
          .limit(input.limit)
          .get(),
        db
          .collection("productSalesPrices")
          .where("organizationId", "==", actor.organizationId)
          .limit(input.limit)
          .get(),
        db
          .collection("branchSalesPrices")
          .where("organizationId", "==", actor.organizationId)
          .where("branchId", "==", input.branchId)
          .limit(input.limit)
          .get(),
        db
          .collection("inventoryBalances")
          .where("organizationId", "==", actor.organizationId)
          .where("locationId", "==", location.id)
          .limit(input.limit)
          .get(),
        db
          .collection("posShifts")
          .where("organizationId", "==", actor.organizationId)
          .where("branchId", "==", input.branchId)
          .where("status", "==", "open")
          .limit(20)
          .get(),
        db
          .collection("customers")
          .where("organizationId", "==", actor.organizationId)
          .where("active", "==", true)
          .where("creditStatus", "==", "approved")
          .limit(200)
          .get(),
        db.collection("salesCredits").where("organizationId", "==", actor.organizationId)
          .where("branchId", "==", input.branchId).where("status", "==", "active").limit(100).get(),
      ]);
    if (
      !branch.exists ||
      branch.get("organizationId") !== actor.organizationId ||
      branch.get("status") !== "active"
    )
      throw new HttpsError("failed-precondition", "Branch is unavailable.");
    const centralByProduct = new Map(
      prices.docs.map((document) => [document.get("productId"), document]),
    );
    const branchByProduct = new Map(
      branchPrices.docs.map((document) => [document.get("productId"), document]),
    );
    const balanceByProduct = new Map(
      balances.docs
        .filter((document) => !document.get("lotId"))
        .map((document) => [document.get("productId"), document]),
    );
    return {
      branch: { id: branch.id, name: branch.get("name"), code: branch.get("code") },
      location: { id: location.id, name: location.get("name") },
      products: products.docs
        .filter(
          (product) =>
            product.get("active") === true &&
            product.get("trackingType") === "quantity",
        )
        .flatMap((product) => {
          const central = centralByProduct.get(product.id);
          if (!central?.exists || central.get("active") !== true) return [];
          const override = branchByProduct.get(product.id);
          const centralVersion = Number(central.get("version"));
          const centralBasePrice = Number(central.get("basePriceMinor"));
          const overrideActive = Boolean(
            override?.exists &&
              override.get("active") === true &&
              (Number(override.get("sellingPriceMinor")) >= centralBasePrice ||
                (override.get("belowBaseApproved") === true &&
                  Number(override.get("basePriceVersion")) === centralVersion)),
          );
          const unitPriceMinor = overrideActive
            ? Number(override?.get("sellingPriceMinor"))
            : centralBasePrice;
          const priceVersion = overrideActive
            ? Number(override?.get("version"))
            : Number(central.get("version"));
          const balance = balanceByProduct.get(product.id);
          return [
            {
              id: product.id,
              sku: product.get("sku"),
              name: product.get("name"),
              unitOfMeasure: product.get("unitOfMeasure"),
              trackingType: product.get("trackingType"),
              unitPriceMinor,
              basePriceMinor: centralBasePrice,
              vatRateBasisPoints: Number(central.get("vatRateBasisPoints")),
              priceVersion,
              priceSource: overrideActive ? "branch" : "central",
              availableQuantity: Number(balance?.get("availableQuantity") ?? 0),
            },
          ];
        }),
      openShift:
        shifts.docs
          .filter((shift) => shift.get("openedBy") === actor.userId)
          .map((shift) => ({ id: shift.id, ...shift.data() }))[0] ?? null,
      customers: customers.docs.map((customer) => ({
        id: customer.id,
        customerNumber: customer.get("customerNumber"),
        name: customer.get("name"),
        phone: customer.get("phone") ?? null,
        creditLimitMinor: Number(customer.get("creditLimitMinor") ?? 0),
        outstandingBalanceMinor: Number(customer.get("outstandingBalanceMinor") ?? 0),
        availableCreditMinor: Number(customer.get("availableCreditMinor") ?? 0),
      })),
      salesCredits: salesCredits.docs.map((credit) => ({
        id: credit.id,
        creditNumber: credit.get("creditNumber"),
        remainingAmountMinor: Number(credit.get("remainingAmountMinor") ?? 0),
        returnId: credit.get("returnId"),
      })),
      refreshedAt: new Date().toISOString(),
    };
  },
);

export const openPosShift = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "sales.shift.manage");
    const input = parseInput(openPosShiftInput, request.data);
    requireBranchScope(actor, input.branchId);
    const branch = db.doc(`branches/${input.branchId}`);
    const shift = db.collection("posShifts").doc();
    const lock = db.doc(
      `posShiftLocks/${uniquenessDocumentId(actor.organizationId, input.branchId, input.deviceId)}`,
    );
    const operation = db.doc(
      `idempotencyKeys/${actor.organizationId}_openPosShift_${input.idempotencyKey}`,
    );
    let result = { shiftId: shift.id, opened: true };
    await db.runTransaction(async (transaction) => {
      const [branchSnapshot, existingLock, previousOperation] =
        await transaction.getAll(branch, lock, operation);
      if (previousOperation!.exists) {
        result = {
          shiftId: String(previousOperation!.get("entityId")),
          opened: false,
        };
        return;
      }
      if (
        !branchSnapshot!.exists ||
        branchSnapshot!.get("organizationId") !== actor.organizationId ||
        branchSnapshot!.get("status") !== "active"
      )
        throw new HttpsError("failed-precondition", "Branch is unavailable.");
      if (existingLock!.exists)
        throw new HttpsError(
          "already-exists",
          "This POS device already has an open shift.",
        );
      const now = FieldValue.serverTimestamp();
      transaction.create(shift, {
        organizationId: actor.organizationId,
        branchId: input.branchId,
        deviceId: input.deviceId,
        deviceName: input.deviceName,
        status: "open",
        openingCashMinor: input.openingCashMinor,
        cashSalesMinor: 0,
        cashRefundsMinor: 0,
        nonCashSalesMinor: 0,
        creditSalesMinor: 0,
        grossSalesMinor: 0,
        saleCount: 0,
        currency: "NGN",
        openedAt: now,
        openedBy: actor.userId,
        createdAt: now,
      });
      transaction.create(lock, {
        organizationId: actor.organizationId,
        branchId: input.branchId,
        deviceId: input.deviceId,
        shiftId: shift.id,
        createdAt: now,
      });
      transaction.create(operation, {
        organizationId: actor.organizationId,
        action: "openPosShift",
        entityId: shift.id,
        status: "completed",
        createdAt: now,
        createdBy: actor.userId,
      });
      writeAuditLog(transaction, actor, {
        action: "pos_shift.opened",
        entityType: "posShift",
        entityId: shift.id,
        correlationId: correlationId(),
        sourceFunction: "openPosShift",
        after: {
          branchId: input.branchId,
          deviceId: input.deviceId,
          openingCashMinor: input.openingCashMinor,
        },
      });
    });
    return result;
  },
);

export const closePosShift = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "sales.shift.manage");
    const input = parseInput(closePosShiftInput, request.data);
    const shift = db.doc(`posShifts/${input.shiftId}`);
    const operation = db.doc(
      `idempotencyKeys/${actor.organizationId}_closePosShift_${input.idempotencyKey}`,
    );
    await db.runTransaction(async (transaction) => {
      const [current, previousOperation] = await transaction.getAll(shift, operation);
      if (previousOperation!.exists) return;
      if (
        !current!.exists ||
        current!.get("organizationId") !== actor.organizationId ||
        current!.get("status") !== "open"
      )
        throw new HttpsError("failed-precondition", "POS shift is not open.");
      requireBranchScope(actor, String(current!.get("branchId")));
      if (
        current!.get("openedBy") !== actor.userId &&
        !hasRole(actor, "branch_manager") &&
        !hasRole(actor, "system_administrator")
      )
        throw new HttpsError(
          "permission-denied",
          "Only the cashier or an authorized manager may close this shift.",
        );
      const expectedCashMinor =
        Number(current!.get("openingCashMinor")) +
        Number(current!.get("cashSalesMinor")) -
        Number(current!.get("cashRefundsMinor") ?? 0);
      const now = FieldValue.serverTimestamp();
      transaction.update(shift, {
        status: "closed",
        closingCashMinor: input.closingCashMinor,
        expectedCashMinor,
        cashVarianceMinor: input.closingCashMinor - expectedCashMinor,
        notes: input.notes ?? null,
        closedAt: now,
        closedBy: actor.userId,
        updatedAt: now,
      });
      transaction.delete(
        db.doc(
          `posShiftLocks/${uniquenessDocumentId(actor.organizationId, String(current!.get("branchId")), String(current!.get("deviceId")))}`,
        ),
      );
      transaction.create(operation, {
        organizationId: actor.organizationId,
        action: "closePosShift",
        entityId: shift.id,
        status: "completed",
        createdAt: now,
        createdBy: actor.userId,
      });
      writeAuditLog(transaction, actor, {
        action: "pos_shift.closed",
        entityType: "posShift",
        entityId: shift.id,
        correlationId: correlationId(),
        sourceFunction: "closePosShift",
        after: {
          expectedCashMinor,
          closingCashMinor: input.closingCashMinor,
          cashVarianceMinor: input.closingCashMinor - expectedCashMinor,
        },
      });
    });
    return { shiftId: input.shiftId, closed: true };
  },
);

export const commitPosSale = onCall(
  { enforceAppCheck, timeoutSeconds: 60 },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "sales.create");
    const input = parseInput(commitSaleInput, request.data);
    if (input.creditAmountMinor > 0)
      requirePermission(actor, "sales.credit.create");
    requireBranchScope(actor, input.branchId);
    const locationOutsideTransaction = await activeBranchLocation(
      actor.organizationId,
      input.branchId,
    );
    const sale = db.collection("sales").doc();
    const inventoryTransaction = db.collection("inventoryTransactions").doc();
    const journal = db.collection("journalEntries").doc();
    const receipt = db.collection("salesReceipts").doc();
    const operation = db.doc(
      `idempotencyKeys/${actor.organizationId}_commitPosSale_${input.idempotencyKey}`,
    );
    const branch = db.doc(`branches/${input.branchId}`);
    const location = locationOutsideTransaction.ref;
    const shift = db.doc(`posShifts/${input.shiftId}`);
    const salesCounter = db.doc(
      `salesCounters/${uniquenessDocumentId(actor.organizationId, input.branchId)}`,
    );
    const inventoryCounter = db.doc(
      `inventoryCounters/${actor.organizationId}_transactions`,
    );
    const journalCounter = db.doc(
      `journalCounters/${uniquenessDocumentId(actor.organizationId, "general")}`,
    );
    const customer = db.doc(
      `customers/${input.customerId ?? "no-credit-customer-placeholder"}`,
    );
    const salesCreditReferences = input.payments.map((payment, index) =>
      db.doc(`salesCredits/${payment.method === "exchange_credit" ? payment.reference : `no-sales-credit-${index}`}`),
    );
    const productReferences = input.lines.map((line) =>
      db.doc(`products/${line.productId}`),
    );
    const centralPriceReferences = input.lines.map((line) =>
      db.doc(`productSalesPrices/${line.productId}`),
    );
    const branchPriceReferences = input.lines.map((line) =>
      db.doc(
        `branchSalesPrices/${branchPriceId(actor.organizationId, input.branchId, line.productId)}`,
      ),
    );
    const balanceReferences = input.lines.map((line) =>
      db.doc(
        `inventoryBalances/${balanceDocumentId(actor.organizationId, line.productId, location.id)}`,
      ),
    );
    const cid = correlationId();
    let result = { saleId: sale.id, saleNumber: "", receiptNumber: "", posted: true };
    await db.runTransaction(async (transaction) => {
      const snapshots = await transaction.getAll(
        operation,
        branch,
        location,
        shift,
        salesCounter,
        inventoryCounter,
        journalCounter,
        customer,
        ...salesCreditReferences,
        ...productReferences,
        ...centralPriceReferences,
        ...branchPriceReferences,
        ...balanceReferences,
      );
      let cursor = 0;
      const previousOperation = snapshots[cursor++]!;
      const branchSnapshot = snapshots[cursor++]!;
      const locationSnapshot = snapshots[cursor++]!;
      const shiftSnapshot = snapshots[cursor++]!;
      const salesCounterSnapshot = snapshots[cursor++]!;
      const inventoryCounterSnapshot = snapshots[cursor++]!;
      const journalCounterSnapshot = snapshots[cursor++]!;
      const customerSnapshot = snapshots[cursor++]!;
      const salesCreditSnapshots = snapshots.slice(cursor, (cursor += input.payments.length));
      const products = snapshots.slice(cursor, (cursor += input.lines.length));
      const centralPrices = snapshots.slice(cursor, (cursor += input.lines.length));
      const branchPrices = snapshots.slice(cursor, (cursor += input.lines.length));
      const balances = snapshots.slice(cursor, (cursor += input.lines.length));
      if (previousOperation.exists) {
        result = {
          saleId: String(previousOperation.get("entityId")),
          saleNumber: String(previousOperation.get("saleNumber")),
          receiptNumber: String(previousOperation.get("receiptNumber")),
          posted: false,
        };
        return;
      }
      if (
        !branchSnapshot.exists ||
        branchSnapshot.get("organizationId") !== actor.organizationId ||
        branchSnapshot.get("status") !== "active"
      )
        throw new HttpsError("failed-precondition", "Branch is unavailable.");
      if (
        !locationSnapshot.exists ||
        locationSnapshot.get("organizationId") !== actor.organizationId ||
        locationSnapshot.get("branchId") !== input.branchId ||
        locationSnapshot.get("status") !== "active"
      )
        throw new HttpsError(
          "failed-precondition",
          "Branch sales-stock location is unavailable.",
        );
      if (
        !shiftSnapshot.exists ||
        shiftSnapshot.get("organizationId") !== actor.organizationId ||
        shiftSnapshot.get("branchId") !== input.branchId ||
        shiftSnapshot.get("deviceId") !== input.deviceId ||
        shiftSnapshot.get("status") !== "open"
      )
        throw new HttpsError("failed-precondition", "Open the correct POS shift first.");
      if (
        shiftSnapshot.get("openedBy") !== actor.userId &&
        !hasRole(actor, "branch_manager") &&
        !hasRole(actor, "system_administrator")
      )
        throw new HttpsError(
          "permission-denied",
          "This shift belongs to another cashier.",
        );
      if (
        input.customerId &&
        (!customerSnapshot.exists ||
          customerSnapshot.get("organizationId") !== actor.organizationId ||
          customerSnapshot.get("active") !== true)
      )
        throw new HttpsError(
          "failed-precondition",
          "Select an active customer from this organization.",
        );
      if (input.creditAmountMinor > 0) {
        if (
          customerSnapshot.get("creditStatus") !== "approved"
        )
          throw new HttpsError(
            "failed-precondition",
            "Select an active customer whose credit has been approved by a system administrator.",
          );
        if (
          input.creditAmountMinor >
          Number(customerSnapshot.get("availableCreditMinor") ?? 0)
        )
          throw new HttpsError(
            "failed-precondition",
            "This sale exceeds the customer's available credit.",
            { code: "CUSTOMER_CREDIT_LIMIT_EXCEEDED", customerId: customer.id },
          );
      }
      input.payments.forEach((payment, index) => {
        if (payment.method !== "exchange_credit") return;
        const credit = salesCreditSnapshots[index]!;
        if (!credit.exists || credit.get("organizationId") !== actor.organizationId || credit.get("branchId") !== input.branchId || credit.get("status") !== "active" || Number(credit.get("remainingAmountMinor") ?? 0) < payment.amountMinor)
          throw new HttpsError("failed-precondition", "The selected exchange credit is unavailable or insufficient.", { code: "EXCHANGE_CREDIT_UNAVAILABLE" });
      });
      const resolvedLines = input.lines.map((line, index) => {
        const product = products[index]!;
        const central = centralPrices[index]!;
        const override = branchPrices[index]!;
        const balance = balances[index]!;
        if (
          !product.exists ||
          product.get("organizationId") !== actor.organizationId ||
          product.get("active") !== true
        )
          throw new HttpsError("failed-precondition", "A sale product is unavailable.");
        if (product.get("trackingType") !== "quantity")
          throw new HttpsError(
            "failed-precondition",
            "Phase 1 POS supports quantity-tracked products. Serialized and batch checkout require their controlled scan workflow.",
          );
        if (
          !central.exists ||
          central.get("organizationId") !== actor.organizationId ||
          central.get("active") !== true
        )
          throw new HttpsError(
            "failed-precondition",
            `Set the central selling price for ${String(product.get("name"))}.`,
          );
        const centralVersion = Number(central.get("version"));
        const centralBasePrice = Number(central.get("basePriceMinor"));
        const overrideActive =
          override.exists &&
          override.get("active") === true &&
          (Number(override.get("sellingPriceMinor")) >= centralBasePrice ||
            (override.get("belowBaseApproved") === true &&
              Number(override.get("basePriceVersion")) === centralVersion));
        const unitPriceMinor = overrideActive
          ? Number(override.get("sellingPriceMinor"))
          : centralBasePrice;
        const vatRateBasisPoints = Number(central.get("vatRateBasisPoints"));
        const priceVersion = overrideActive
          ? Number(override.get("version"))
          : Number(central.get("version"));
        if (
          input.offline &&
          (line.unitPriceMinor !== unitPriceMinor ||
            line.vatRateBasisPoints !== vatRateBasisPoints ||
            line.priceVersion !== priceVersion)
        )
          throw new HttpsError(
            "failed-precondition",
            "An offline sale uses an outdated price. Refresh it for explicit review.",
            { code: "STALE_POS_PRICE", productId: product.id },
          );
        const onHandQuantity = Number(balance.get("onHandQuantity") ?? 0);
        const reservedQuantity = Number(balance.get("reservedQuantity") ?? 0);
        if (
          !balance.exists ||
          balance.get("organizationId") !== actor.organizationId ||
          balance.get("locationId") !== location.id ||
          onHandQuantity - reservedQuantity < line.quantity
        )
          throw new HttpsError(
            "failed-precondition",
            "Insufficient branch stock. Keep the offline sale queued for manager reconciliation.",
            { code: "POS_STOCK_RECONCILIATION_REQUIRED", productId: product.id },
          );
        const issued = issueCost(
          {
            quantity: onHandQuantity,
            totalValueMinor: Number(balance.get("totalValueMinor") ?? 0),
            averageUnitCostMinor: Number(balance.get("averageUnitCostMinor") ?? 0),
          },
          line.quantity,
        );
        return {
          input: line,
          product,
          balance,
          unitPriceMinor,
          vatRateBasisPoints,
          priceVersion,
          priceSource: overrideActive ? "branch" : "central",
          issued,
          reservedQuantity,
        };
      });
      const calculated = calculateSale(
        resolvedLines.map((line) => ({
          quantity: line.input.quantity,
          unitPriceMinor: line.unitPriceMinor,
          vatRateBasisPoints: line.vatRateBasisPoints,
          unitCostMinor: line.issued.unitCostMinor,
        })),
      );
      try {
        assertPaymentsEqualTotal(
          [
            ...input.payments.map((payment) => payment.amountMinor),
            ...(input.creditAmountMinor > 0 ? [input.creditAmountMinor] : []),
          ],
          calculated.grossAmountMinor,
        );
      } catch (error) {
        throw new HttpsError(
          "invalid-argument",
          error instanceof Error ? error.message : "Payment total is invalid.",
        );
      }
      const paymentJournalLines = input.payments.map((payment) => ({
        accountCode: paymentAccount[payment.method]!,
        debitMinor: payment.amountMinor,
        creditMinor: 0,
      }));
      const journalLines = [
        ...paymentJournalLines,
        ...(input.creditAmountMinor > 0
          ? [{ accountCode: "1100", debitMinor: input.creditAmountMinor, creditMinor: 0 }]
          : []),
        { accountCode: "5000", debitMinor: calculated.costAmountMinor, creditMinor: 0 },
        { accountCode: "4000", debitMinor: 0, creditMinor: calculated.netAmountMinor },
        { accountCode: "2100", debitMinor: 0, creditMinor: calculated.vatAmountMinor },
        { accountCode: "1200", debitMinor: 0, creditMinor: calculated.costAmountMinor },
      ].filter((line) => line.debitMinor > 0 || line.creditMinor > 0);
      try {
        assertBalancedJournal(journalLines);
      } catch {
        throw new HttpsError(
          "internal",
          "The sale journal could not be balanced.",
        );
      }
      const now = FieldValue.serverTimestamp();
      const recordedAt = Timestamp.fromDate(new Date(input.recordedAt));
      const year = new Date(input.recordedAt).getUTCFullYear();
      const salesSequence = Number(salesCounterSnapshot.get("value") ?? 0) + 1;
      const inventorySequence =
        Number(inventoryCounterSnapshot.get("value") ?? 0) + 1;
      const journalSequence = Number(journalCounterSnapshot.get("value") ?? 0) + 1;
      const branchCode = String(branchSnapshot.get("code"));
      const saleNumber = `SAL-${branchCode}-${year}-${String(salesSequence).padStart(6, "0")}`;
      const receiptNumber = `RCT-${branchCode}-${year}-${String(salesSequence).padStart(6, "0")}`;
      const inventoryNumber = `INV-${year}-${String(inventorySequence).padStart(6, "0")}`;
      const journalNumber = `JRN-${year}-${String(journalSequence).padStart(6, "0")}`;
      result = { saleId: sale.id, saleNumber, receiptNumber, posted: true };
      transaction.set(salesCounter, {
        organizationId: actor.organizationId,
        branchId: input.branchId,
        kind: "sale",
        value: salesSequence,
        updatedAt: now,
      });
      transaction.set(inventoryCounter, {
        organizationId: actor.organizationId,
        kind: "inventoryTransaction",
        value: inventorySequence,
        updatedAt: now,
      }, { merge: true });
      transaction.set(journalCounter, {
        organizationId: actor.organizationId,
        kind: "journalEntry",
        value: journalSequence,
        updatedAt: now,
      });
      transaction.create(sale, clean({
        organizationId: actor.organizationId,
        branchId: input.branchId,
        branchName: branchSnapshot.get("name"),
        branchCode,
        locationId: location.id,
        shiftId: shift.id,
        deviceId: input.deviceId,
        saleNumber,
        receiptNumber,
        provisionalReceiptReference: input.provisionalReceiptReference,
        status: "completed",
        paymentStatus:
          input.creditAmountMinor === calculated.grossAmountMinor
            ? "credit"
            : input.creditAmountMinor > 0
              ? "partially_paid"
              : input.offline && input.payments.some((payment) => payment.method !== "cash")
                ? "awaiting_verification"
                : "recorded",
        customerId: input.customerId,
        customerNumber: input.customerId
          ? customerSnapshot.get("customerNumber")
          : undefined,
        customerName: input.customerId ? customerSnapshot.get("name") : undefined,
        creditAmountMinor: input.creditAmountMinor,
        amountPaidMinor: calculated.grossAmountMinor - input.creditAmountMinor,
        source: input.offline ? "offline_sync" : "online_pos",
        netAmountMinor: calculated.netAmountMinor,
        vatAmountMinor: calculated.vatAmountMinor,
        grossAmountMinor: calculated.grossAmountMinor,
        costAmountMinor: calculated.costAmountMinor,
        currency: "NGN",
        itemCount: input.lines.length,
        totalQuantity: input.lines.reduce((sum, line) => sum + line.quantity, 0),
        notes: input.notes,
        recordedAt,
        postedAt: now,
        createdAt: now,
        createdBy: actor.userId,
      }));
      transaction.create(receipt, clean({
        organizationId: actor.organizationId,
        branchId: input.branchId,
        saleId: sale.id,
        saleNumber,
        receiptNumber,
        provisionalReceiptReference: input.provisionalReceiptReference,
        netAmountMinor: calculated.netAmountMinor,
        vatAmountMinor: calculated.vatAmountMinor,
        grossAmountMinor: calculated.grossAmountMinor,
        customerId: input.customerId,
        customerNumber: input.customerId
          ? customerSnapshot.get("customerNumber")
          : undefined,
        customerName: input.customerId ? customerSnapshot.get("name") : undefined,
        creditAmountMinor: input.creditAmountMinor,
        amountPaidMinor: calculated.grossAmountMinor - input.creditAmountMinor,
        currency: "NGN",
        issuedAt: now,
        issuedBy: actor.userId,
      }));
      transaction.create(inventoryTransaction, {
        organizationId: actor.organizationId,
        transactionNumber: inventoryNumber,
        transactionType: "branch_sale",
        status: "posted",
        referenceType: "sale",
        referenceId: sale.id,
        referenceNumber: saleNumber,
        sourceLocationId: location.id,
        sourceBranchId: input.branchId,
        effectiveAt: recordedAt,
        postedAt: now,
        postedBy: actor.userId,
        reason: "Branch POS sale",
        idempotencyKey: input.idempotencyKey,
        correlationId: cid,
        createdAt: now,
        createdBy: actor.userId,
      });
      resolvedLines.forEach((line, index) => {
        const calculatedLine = calculated.lines[index]!;
        const saleItem = db.collection("saleItems").doc();
        transaction.create(saleItem, {
          organizationId: actor.organizationId,
          branchId: input.branchId,
          saleId: sale.id,
          productId: line.product.id,
          sku: line.product.get("sku"),
          productName: line.product.get("name"),
          unitOfMeasure: line.product.get("unitOfMeasure"),
          trackingType: line.product.get("trackingType"),
          quantity: line.input.quantity,
          unitPriceMinor: line.unitPriceMinor,
          basePriceMinor: centralPrices[index]!.get("basePriceMinor"),
          priceVersion: line.priceVersion,
          priceSource: line.priceSource,
          vatRateBasisPoints: line.vatRateBasisPoints,
          netAmountMinor: calculatedLine.netAmountMinor,
          vatAmountMinor: calculatedLine.vatAmountMinor,
          grossAmountMinor: calculatedLine.grossAmountMinor,
          unitCostMinor: line.issued.unitCostMinor,
          costAmountMinor: calculatedLine.costAmountMinor,
          currency: "NGN",
          createdAt: now,
        });
        const beforeQuantity = Number(line.balance.get("onHandQuantity"));
        const next = line.issued.balance;
        transaction.update(balanceReferences[index]!, {
          onHandQuantity: next.quantity,
          availableQuantity: next.quantity - line.reservedQuantity,
          averageUnitCostMinor: next.averageUnitCostMinor,
          totalValueMinor: next.totalValueMinor,
          lastTransactionId: inventoryTransaction.id,
          lastMovementAt: recordedAt,
          version: Number(line.balance.get("version") ?? 0) + 1,
          updatedAt: now,
        });
        transaction.update(productReferences[index]!, {
          hasLedgerActivity: true,
          updatedAt: now,
        });
        const entryBase = clean({
          organizationId: actor.organizationId,
          transactionId: inventoryTransaction.id,
          transactionNumber: inventoryNumber,
          transactionType: "branch_sale",
          productId: line.product.id,
          sku: line.product.get("sku"),
          productName: line.product.get("name"),
          categoryId: line.product.get("categoryId"),
          brand: line.product.get("brand"),
          trackingType: line.product.get("trackingType"),
          unitCostMinor: line.issued.unitCostMinor,
          currency: "NGN",
          effectiveAt: recordedAt,
          postedBy: actor.userId,
          reason: "Branch POS sale",
          referenceNumber: saleNumber,
          createdAt: now,
        });
        transaction.create(db.collection("inventoryEntries").doc(), {
          ...entryBase,
          locationId: location.id,
          branchId: input.branchId,
          externalAccount: null,
          quantityDelta: -line.input.quantity,
          valueDeltaMinor: -line.issued.movementValueMinor,
          balanceBefore: beforeQuantity,
          balanceAfter: next.quantity,
        });
        transaction.create(db.collection("inventoryEntries").doc(), {
          ...entryBase,
          externalAccount: "customer_sales",
          counterpartyLocationId: location.id,
          quantityDelta: line.input.quantity,
          valueDeltaMinor: line.issued.movementValueMinor,
          balanceBefore: 0,
          balanceAfter: 0,
        });
      });
      input.payments.forEach((payment) => {
        transaction.create(db.collection("salePayments").doc(), clean({
          organizationId: actor.organizationId,
          branchId: input.branchId,
          saleId: sale.id,
          shiftId: shift.id,
          method: payment.method,
          amountMinor: payment.amountMinor,
          reference: payment.reference,
          status: input.offline && payment.method !== "cash"
            ? "awaiting_verification"
            : "recorded",
          currency: "NGN",
          recordedAt,
          recordedBy: actor.userId,
          createdAt: now,
        }));
      });
      input.payments.forEach((payment, index) => {
        if (payment.method !== "exchange_credit") return;
        const credit = salesCreditSnapshots[index]!;
        const remaining = Number(credit.get("remainingAmountMinor")) - payment.amountMinor;
        transaction.update(salesCreditReferences[index]!, {
          remainingAmountMinor: remaining,
          status: remaining === 0 ? "redeemed" : "active",
          lastRedeemedSaleId: sale.id,
          updatedAt: now,
          updatedBy: actor.userId,
        });
      });
      if (input.creditAmountMinor > 0) {
        const outstanding = Number(
          customerSnapshot.get("outstandingBalanceMinor") ?? 0,
        );
        const nextOutstanding = outstanding + input.creditAmountMinor;
        const creditLimit = Number(customerSnapshot.get("creditLimitMinor") ?? 0);
        transaction.update(customer, {
          outstandingBalanceMinor: nextOutstanding,
          availableCreditMinor: Math.max(0, creditLimit - nextOutstanding),
          updatedAt: now,
          updatedBy: actor.userId,
        });
        transaction.create(db.collection("customerAccountEntries").doc(), {
          organizationId: actor.organizationId,
          branchId: input.branchId,
          customerId: customer.id,
          entryType: "credit_sale",
          referenceType: "sale",
          referenceId: sale.id,
          referenceNumber: saleNumber,
          amountMinor: input.creditAmountMinor,
          balanceAfterMinor: nextOutstanding,
          currency: "NGN",
          effectiveAt: recordedAt,
          createdAt: now,
          createdBy: actor.userId,
        });
      }
      transaction.create(journal, {
        organizationId: actor.organizationId,
        branchId: input.branchId,
        journalNumber,
        journalType: "sale",
        status: "posted",
        referenceType: "sale",
        referenceId: sale.id,
        referenceNumber: saleNumber,
        description: `POS sale ${saleNumber}`,
        totalDebitMinor: journalLines.reduce((sum, line) => sum + line.debitMinor, 0),
        totalCreditMinor: journalLines.reduce((sum, line) => sum + line.creditMinor, 0),
        currency: "NGN",
        effectiveAt: recordedAt,
        postedAt: now,
        postedBy: actor.userId,
        correlationId: cid,
        createdAt: now,
      });
      journalLines.forEach((line) => {
        const account = db.doc(
          `chartOfAccounts/${uniquenessDocumentId(actor.organizationId, line.accountCode)}`,
        );
        transaction.set(account, {
          organizationId: actor.organizationId,
          code: line.accountCode,
          name: accountNames[line.accountCode],
          currency: "NGN",
          active: true,
          systemManaged: true,
          updatedAt: now,
        }, { merge: true });
        transaction.create(db.collection("journalLines").doc(), {
          organizationId: actor.organizationId,
          branchId: input.branchId,
          journalEntryId: journal.id,
          journalNumber,
          accountId: account.id,
          accountCode: line.accountCode,
          accountName: accountNames[line.accountCode],
          debitMinor: line.debitMinor,
          creditMinor: line.creditMinor,
          currency: "NGN",
          effectiveAt: recordedAt,
          createdAt: now,
        });
      });
      const cashAmount = input.payments
        .filter((payment) => payment.method === "cash")
        .reduce((sum, payment) => sum + payment.amountMinor, 0);
      transaction.update(shift, {
        cashSalesMinor: Number(shiftSnapshot.get("cashSalesMinor") ?? 0) + cashAmount,
        nonCashSalesMinor:
          Number(shiftSnapshot.get("nonCashSalesMinor") ?? 0) +
          input.payments.reduce((sum, payment) => sum + payment.amountMinor, 0) -
          cashAmount,
        creditSalesMinor:
          Number(shiftSnapshot.get("creditSalesMinor") ?? 0) +
          input.creditAmountMinor,
        grossSalesMinor:
          Number(shiftSnapshot.get("grossSalesMinor") ?? 0) +
          calculated.grossAmountMinor,
        saleCount: Number(shiftSnapshot.get("saleCount") ?? 0) + 1,
        updatedAt: now,
      });
      transaction.create(operation, {
        organizationId: actor.organizationId,
        action: "commitPosSale",
        entityId: sale.id,
        saleNumber,
        receiptNumber,
        status: "completed",
        createdAt: now,
        createdBy: actor.userId,
      });
      writeAuditLog(transaction, actor, {
        action: "sale.completed",
        entityType: "sale",
        entityId: sale.id,
        correlationId: cid,
        sourceFunction: "commitPosSale",
        after: {
          branchId: input.branchId,
          saleNumber,
          grossAmountMinor: calculated.grossAmountMinor,
          source: input.offline ? "offline_sync" : "online_pos",
        },
      });
    });
    logger.info("POS sale committed", {
      organizationId: actor.organizationId,
      branchId: input.branchId,
      actorUserId: actor.userId,
      saleId: result.saleId,
      saleNumber: result.saleNumber,
      posted: result.posted,
      correlationId: cid,
    });
    return result;
  },
);

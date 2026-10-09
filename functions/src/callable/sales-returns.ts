import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import { bankAccountSummary, resolveSettlementAccount } from "../accounting/settlement-account.js";
import {
  accountingPeriodReference,
  assertAccountingPeriodOpen,
} from "../accounting/period-lock.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import {
  canSelfAuthorize,
  requireAccess,
  requireBranchScope,
  requirePermission,
} from "../auth/authorize.js";
import { enforceAppCheck } from "../config.js";
import {
  balanceDocumentId,
  uniquenessDocumentId,
} from "../inventory/calculations.js";
import { assertBalancedJournal } from "../sales/calculations.js";
import { followUpSaleReturn } from "../sales/return-follow-up.js";
import { operationalEvidence, operationalEvidenceInput } from "../sales/operational-evidence.js";
import { readSaleSerials, serialCost, changeSaleSerials, writeSaleSerialEntries } from "../sales/serials.js";
import { selectedArrangement, changeArrangementBalance } from "../sales/customer-arrangements.js";
import { changeMoneyBalance, legacyDebt, reduceInvoice } from "../sales/receivables.js";
import { correlationId, parseInput } from "../utils/callable.js";
import {
  approveSaleReturnInput,
  createSaleReturnInput,
  listSaleReturnsInput,
  saleReturnWorkspaceInput,
} from "../validation/sales.js";

const refundAccounts: Readonly<Record<string, { code: string; name: string }>> =
  {
    cash: { code: "1010", name: "Cash on hand" },
    card: { code: "1020", name: "Card clearing" },
    bank_transfer: { code: "1030", name: "Bank transfer clearing" },
    customer_account: { code: "1100", name: "Accounts receivable" },
    exchange_credit: { code: "2200", name: "Customer exchange credits" },
  };
const accountNames: Readonly<Record<string, string>> = {
  "1010": "Cash on hand",
  "1020": "Card clearing",
  "1030": "Bank transfer clearing",
  "1100": "Accounts receivable",
  "1200": "Inventory asset",
  "2100": "VAT payable",
  "2200": "Customer exchange credits",
  "4010": "Sales returns and allowances",
  "5000": "Cost of goods sold",
};
function clean(values: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(values).filter(
      ([, value]) => value !== undefined && value !== "",
    ),
  );
}
async function branchLocation(organizationId: string, branchId: string) {
  const result = await db
    .collection("inventoryLocations")
    .where("organizationId", "==", organizationId)
    .where("branchId", "==", branchId)
    .where("type", "==", "branch")
    .limit(5)
    .get();
  const active = result.docs.filter(
    (document) => document.get("status") === "active",
  );
  if (active.length !== 1)
    throw new HttpsError(
      "failed-precondition",
      "The branch requires exactly one active sales-stock location.",
    );
  return active[0]!;
}
function returnCounterId(organizationId: string, saleItemId: string) {
  return uniquenessDocumentId(organizationId, "saleReturnItem", saleItemId);
}

export const getSaleReturnWorkspace = onCall(
  { enforceAppCheck },
  async (request) => {
    const actor = await requireAccess(request);
    if (["list_evidence", "read_evidence", "upload_evidence"].includes(request.data?.action))
      return operationalEvidence(actor, "customer_return", parseInput(operationalEvidenceInput, request.data));
    requirePermission(actor, "sales.returns.create");
    const input = parseInput(saleReturnWorkspaceInput, request.data);
    requireBranchScope(actor, input.branchId);
    const saleQuery = await db
      .collection("sales")
      .where("organizationId", "==", actor.organizationId)
      .where("branchId", "==", input.branchId)
      .where("receiptNumber", "==", input.receiptNumber)
      .limit(1)
      .get();
    const saleNumberQuery = saleQuery.empty ? await db.collection("sales")
      .where("organizationId", "==", actor.organizationId)
      .where("branchId", "==", input.branchId)
      .where("saleNumber", "==", input.receiptNumber)
      .limit(1).get() : null;
    const sale = saleQuery.docs[0] ?? saleNumberQuery?.docs[0];
    if (!sale || sale.get("status") !== "completed")
      throw new HttpsError(
        "not-found",
        "No completed sale matches this branch receipt.",
      );
    const [items, openShifts, customer] = await Promise.all([
      db.collection("saleItems").where("saleId", "==", sale.id).get(),
      db
        .collection("posShifts")
        .where("organizationId", "==", actor.organizationId)
        .where("branchId", "==", input.branchId)
        .where("status", "==", "open")
        .limit(20)
        .get(),
      sale.get("customerId") ? db.doc(`customers/${sale.get("customerId")}`).get() : Promise.resolve(null),
    ]);
    const counters = await Promise.all(
      items.docs.map((item) =>
        db
          .doc(
            `saleReturnItemCounters/${returnCounterId(actor.organizationId, item.id)}`,
          )
          .get(),
      ),
    );
    return {
      bankAccounts: (await db.collection("bankAccounts").where("organizationId", "==", actor.organizationId).where("active", "==", true).limit(100).get()).docs.map(bankAccountSummary),
      sale: {
        id: sale.id,
        saleNumber: sale.get("saleNumber"),
        receiptNumber: sale.get("receiptNumber"),
        branchId: sale.get("branchId"),
        customerId: sale.get("customerId") ?? null,
        customerName: sale.get("customerName") ?? null,
        customerOutstandingMinor: Number(customer?.get("outstandingBalanceMinor") ?? 0),
        grossAmountMinor: Number(sale.get("grossAmountMinor") ?? 0),
        recordedAt: sale.get("recordedAt"),
      },
      items: items.docs.map((item, index) => ({
        id: item.id,
        trackingType: item.get("trackingType") ?? "quantity",
        returnableSerialNumbers: (item.get("collectedSerialNumbers") ?? []).filter((serial: string) => !(counters[index]!.get("returnedSerialNumbers") ?? []).includes(serial)),
        cancellableSerialNumbers: (item.get("serialNumbers") ?? []).filter((serial: string) => !(item.get("collectedSerialNumbers") ?? []).includes(serial) && !(item.get("cancelledSerialNumbers") ?? []).includes(serial)),
        productId: item.get("productId"),
        sku: item.get("sku"),
        productName: item.get("productName"),
        unitOfMeasure: item.get("unitOfMeasure"),
        soldQuantity: Number(item.get("quantity")),
        returnedQuantity: Number(counters[index]!.get("returnedQuantity") ?? 0),
        cancelledQuantity: Number(item.get("cancelledQuantity") ?? 0),
        reversedNetAmountMinor: counters[index]!.get("reversedNetAmountMinor") ?? null,
        reversedVatAmountMinor: counters[index]!.get("reversedVatAmountMinor") ?? null,
        cancellableQuantity: Math.max(0, Number(item.get("quantity")) - Number(item.get("collectedQuantity") ?? item.get("quantity")) - Number(item.get("cancelledQuantity") ?? 0)),
        returnableQuantity:
          Number(item.get("collectedQuantity") ?? item.get("quantity")) -
          Number(counters[index]!.get("returnedQuantity") ?? 0),
        unitPriceMinor: Number(item.get("unitPriceMinor")),
        vatRateBasisPoints: Number(item.get("vatRateBasisPoints")),
        netAmountMinor: Number(item.get("netAmountMinor") ?? Number(item.get("quantity")) * Number(item.get("unitPriceMinor"))),
        vatAmountMinor: Number(item.get("vatAmountMinor") ?? Math.round(Number(item.get("quantity")) * Number(item.get("unitPriceMinor")) * Number(item.get("vatRateBasisPoints")) / 10_000)),
        grossAmountMinor: Number(item.get("grossAmountMinor") ?? Number(item.get("quantity")) * Number(item.get("unitPriceMinor")) + Math.round(Number(item.get("quantity")) * Number(item.get("unitPriceMinor")) * Number(item.get("vatRateBasisPoints")) / 10_000)),
      })),
      openShifts: openShifts.docs.map((shift) => ({
        id: shift.id,
        deviceName: shift.get("deviceName"),
        openedByName: shift.get("openedByName") ?? null,
      })),
    };
  },
);

export const listSaleReturns = onCall({ enforceAppCheck }, async (request) => {
  const actor = await requireAccess(request);
  requirePermission(actor, "sales.returns.read");
  const input = parseInput(listSaleReturnsInput, request.data);
  requireBranchScope(actor, input.branchId);
  let query = db
    .collection("saleReturns")
    .where("organizationId", "==", actor.organizationId)
    .where("branchId", "==", input.branchId)
    .where("status", "==", input.status);
  if (input.cursor) {
    const cursor = await db.doc(`saleReturns/${input.cursor}`).get();
    if (!cursor.exists || cursor.get("organizationId") !== actor.organizationId || cursor.get("branchId") !== input.branchId || cursor.get("status") !== input.status)
      throw new HttpsError("invalid-argument", "Start from the first returns page.");
    query = query.startAfter(cursor);
  }
  const result = await query.limit(input.limit + 1).get();
  const visible = result.docs.slice(0, input.limit);
  const details = await Promise.all(visible.map(async (document) => {
    const [items, credit] = await Promise.all([
      db.collection("saleReturnItems").where("returnId", "==", document.id).limit(50).get(),
      document.get("exchangeCreditId") ? db.doc(`salesCredits/${document.get("exchangeCreditId")}`).get() : Promise.resolve(null),
    ]);
    return { id: document.id, ...document.data(), items: items.docs.map(item => ({ id: item.id, ...item.data() })), exchangeCredit: credit?.exists ? { id: credit.id, remainingAmountMinor: credit.get("remainingAmountMinor"), status: credit.get("status"), lastRedeemedSaleId: credit.get("lastRedeemedSaleId") ?? null, lastRedeemedSaleNumber: credit.get("lastRedeemedSaleNumber") ?? null } : null };
  }));
  const shifts = await db.collection("posShifts").where("organizationId", "==", actor.organizationId).where("branchId", "==", input.branchId).where("status", "==", "open").limit(20).get();
  return {
    moreAvailable: result.size > input.limit,
    nextCursor: result.size > input.limit ? visible.at(-1)!.id : null,
    openShifts: shifts.docs.map(shift => ({ id: shift.id, deviceName: shift.get("deviceName") })),
    bankAccounts: (await db.collection("bankAccounts").where("organizationId", "==", actor.organizationId).where("active", "==", true).limit(100).get()).docs.map(bankAccountSummary),
    returns: details,
  };
});

export const createSaleReturn = onCall({ enforceAppCheck }, async (request) => {
  const actor = await requireAccess(request);
  requirePermission(actor, "sales.returns.create");
  const input = parseInput(createSaleReturnInput, request.data);
  const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  requireBranchScope(actor, input.branchId);
  const sale = await db.doc(`sales/${input.saleId}`).get();
  if (
    !sale.exists ||
    sale.get("organizationId") !== actor.organizationId ||
    sale.get("branchId") !== input.branchId ||
    sale.get("status") !== "completed"
  )
    throw new HttpsError(
      "failed-precondition",
      "The original completed sale is unavailable.",
    );
  if (input.resolution === "customer_account" && !sale.get("customerId"))
    throw new HttpsError(
      "failed-precondition",
      "Only a named customer sale can be credited to Accounts Receivable.",
    );
  if (input.resolution === "cash") {
    const shift = await db.doc(`posShifts/${input.refundShiftId}`).get();
    if (
      !shift.exists ||
      shift.get("organizationId") !== actor.organizationId ||
      shift.get("branchId") !== input.branchId ||
      shift.get("status") !== "open"
    )
      throw new HttpsError(
        "failed-precondition",
        "Select an open POS shift at this branch for the cash refund.",
      );
  }
  const itemRefs = input.lines.map((line) =>
    db.doc(`saleItems/${line.saleItemId}`),
  );
  const counterRefs = input.lines.map((line) =>
    db.doc(
      `saleReturnItemCounters/${returnCounterId(actor.organizationId, line.saleItemId)}`,
    ),
  );
  const returnRecord = db.collection("saleReturns").doc();
  const operation = db.doc(
    `idempotencyKeys/${actor.organizationId}_createSaleReturn_${input.idempotencyKey}`,
  );
  let result = { returnId: returnRecord.id, returnNumber: "", created: true };
  await db.runTransaction(async (transaction) => {
    const bankAccountSnapshot = await transaction.get(db.doc(`bankAccounts/${input.bankAccountId ?? "no-bank-account"}`));
    const snapshots = await transaction.getAll(
      operation,
      ...itemRefs,
      ...counterRefs,
    );
    const previous = snapshots[0]!;
    if (previous.exists) {
      if (previous.get("fingerprint") && previous.get("fingerprint") !== fingerprint)
        throw new HttpsError("already-exists", "This retry reference belongs to a different return.");
      result = {
        returnId: String(previous.get("entityId")),
        returnNumber: String(previous.get("returnNumber")),
        created: false,
      };
      return;
    }
    if (input.resolution === "card" || input.resolution === "bank_transfer")
      resolveSettlementAccount(actor.organizationId, input.resolution, input.bankAccountId, bankAccountSnapshot);
    const items = snapshots.slice(1, 1 + input.lines.length);
    const counters = snapshots.slice(1 + input.lines.length);
    const saleSerials = await readSaleSerials(transaction, { organizationId: actor.organizationId, locationId: String(sale.get("locationId")), saleId: sale.id }, input.lines.map((line, index) => ({ ...line, productId: String(items[index]!.get("productId")), trackingType: String(items[index]!.get("trackingType")) })), input.kind === "reservation_cancellation" ? "cancel" : "return");
    const calculated = input.lines.map((line, index) => {
      const item = items[index]!;
      if (
        !item.exists ||
        item.get("organizationId") !== actor.organizationId ||
        item.get("saleId") !== input.saleId
      )
        throw new HttpsError(
          "invalid-argument",
          "A return line does not belong to this sale.",
        );
      const cancellation = input.kind === "reservation_cancellation";
      const remaining = cancellation
        ? Number(item.get("quantity")) - Number(item.get("collectedQuantity") ?? item.get("quantity")) - Number(item.get("cancelledQuantity") ?? 0)
        : Number(item.get("collectedQuantity") ?? item.get("quantity")) - Number(counters[index]!.get("returnedQuantity") ?? 0);
      if (line.quantity > remaining)
        throw new HttpsError(
          "failed-precondition",
          "A return quantity exceeds the remaining returnable quantity.",
        );
      const soldQuantity = Number(item.get("quantity"));
      const returnedQuantity = Number(counters[index]!.get("returnedQuantity") ?? 0);
      const collectedQuantity = Number(item.get("collectedQuantity") ?? soldQuantity);
      const collectedCost = Number(item.get("costAmountMinor") ?? 0);
      const returnedCost = Number(counters[index]!.get("returnedCostAmountMinor") ?? Math.round(collectedCost * returnedQuantity / collectedQuantity));
      const reversedQuantity = returnedQuantity + Number(item.get("cancelledQuantity") ?? 0);
      const allocated = (total: number, field?: string) => Math.round(total * (reversedQuantity + line.quantity) / soldQuantity) - Number((field && counters[index]!.get(field)) ?? Math.round(total * reversedQuantity / soldQuantity));
      const originalNet = Number(item.get("netAmountMinor") ?? soldQuantity * Number(item.get("unitPriceMinor")));
      const originalVat = Number(item.get("vatAmountMinor") ?? Math.round(originalNet * Number(item.get("vatRateBasisPoints")) / 10_000));
      const net = allocated(originalNet, "reversedNetAmountMinor");
      const vat = allocated(originalVat, "reversedVatAmountMinor");
      return {
        input: line,
        item,
        net,
        vat,
        gross: net + vat,
        serials: saleSerials[index]!,
        cost: cancellation ? 0 : saleSerials[index]!.length ? serialCost(saleSerials[index]!) : item.get("collectionTracked") === true
          ? Math.round(Math.max(0, collectedCost - returnedCost) * line.quantity / (collectedQuantity - returnedQuantity))
          : allocated(Number(item.get("costAmountMinor") ?? soldQuantity * Number(item.get("unitCostMinor") ?? 0))),
      };
    });
    const now = FieldValue.serverTimestamp();
    const returnNumber = `RTN-${String(sale.get("branchCode"))}-${new Date().getUTCFullYear()}-${returnRecord.id.slice(0, 8).toUpperCase()}`;
    const total = (key: "net" | "vat" | "gross" | "cost") =>
      calculated.reduce((sum, line) => sum + line[key], 0);
    transaction.create(returnRecord, {
      organizationId: actor.organizationId,
      branchId: input.branchId,
      saleId: input.saleId,
      saleNumber: sale.get("saleNumber"),
      receiptNumber: sale.get("receiptNumber"),
      returnNumber,
      customerId: sale.get("customerId") ?? null,
      customerName: sale.get("customerName") ?? null,
      customerAccountId: sale.get("customerAccountId") ?? "general",
      customerAccountName: sale.get("customerAccountName") ?? "General account",
      status: "submitted",
      inspectionStatus: input.kind === "reservation_cancellation" ? "not_required" : "required",
      kind: input.kind,
      resolution: input.resolution,
      refundShiftId: input.refundShiftId ?? null,
      bankAccountId: input.bankAccountId ?? null,
      reason: input.reason,
      netAmountMinor: total("net"),
      vatAmountMinor: total("vat"),
      grossAmountMinor: total("gross"),
      restockCostMinor: calculated
        .filter((line) => line.input.condition === "restockable")
        .reduce((sum, line) => sum + line.cost, 0),
      currency: "NGN",
      createdAt: now,
      createdBy: actor.userId,
      submittedAt: now,
    });
    for (const line of calculated)
      transaction.create(db.collection("saleReturnItems").doc(), {
        organizationId: actor.organizationId,
        branchId: input.branchId,
        returnId: returnRecord.id,
        saleId: input.saleId,
        saleItemId: line.item.id,
        productId: line.item.get("productId"),
        sku: line.item.get("sku"),
        productName: line.item.get("productName"),
        quantity: line.input.quantity,
        serialNumbers: line.serials.map(serial => String(serial.get("serialNumber"))),
        condition: "non_restockable",
        requestedCondition: line.input.condition,
        inspectionStatus: input.kind === "reservation_cancellation" ? "not_required" : "required",
        unitPriceMinor: line.item.get("unitPriceMinor"),
        vatRateBasisPoints: line.item.get("vatRateBasisPoints"),
        unitCostMinor: line.item.get("unitCostMinor"),
        netAmountMinor: line.net,
        vatAmountMinor: line.vat,
        grossAmountMinor: line.gross,
        costAmountMinor: line.cost,
        currency: "NGN",
        createdAt: now,
      });
    transaction.create(operation, {
      organizationId: actor.organizationId,
      action: "createSaleReturn",
      fingerprint,
      entityId: returnRecord.id,
      returnNumber,
      status: "completed",
      createdAt: now,
      createdBy: actor.userId,
    });
    writeAuditLog(transaction, actor, {
      action: "sale_return.submitted",
      entityType: "saleReturn",
      entityId: returnRecord.id,
      reason: input.reason,
      correlationId: correlationId(),
      sourceFunction: "createSaleReturn",
      after: {
        returnNumber,
        saleId: input.saleId,
        resolution: input.resolution,
        grossAmountMinor: total("gross"),
      },
    });
    result = { returnId: returnRecord.id, returnNumber, created: true };
  });
  return result;
});

export const approveSaleReturn = onCall(
  { enforceAppCheck, timeoutSeconds: 60 },
  async (request) => {
    const actor = await requireAccess(request);
    requirePermission(actor, "sales.returns.approve");
    const input = parseInput(approveSaleReturnInput, request.data);
    if (input.action !== "approve") {
      try { return await followUpSaleReturn(actor, input); }
      catch (cause) {
        if (cause instanceof HttpsError && ["failed-precondition", "invalid-argument", "already-exists"].includes(cause.code))
          throw new HttpsError(cause.code, cause.message, { code: "SALE_RETURN_ACTION_REQUIRED", userMessage: cause.message });
        throw cause;
      }
    }
    const returnRef = db.doc(`saleReturns/${input.returnId}`);
    const initial = await returnRef.get();
    if (
      !initial.exists ||
      initial.get("organizationId") !== actor.organizationId
    )
      throw new HttpsError("not-found", "Return not found.");
    requireBranchScope(actor, String(initial.get("branchId")));
    const returnItemsQuery = await db
      .collection("saleReturnItems")
      .where("returnId", "==", input.returnId)
      .get();
    if (returnItemsQuery.empty)
      throw new HttpsError("failed-precondition", "The return has no items.");
    const cancellation = initial.get("kind") === "reservation_cancellation";
    if (cancellation) requirePermission(actor, "sales.stock.release");
    const saleRef = db.doc(`sales/${initial.get("saleId")}`);
    const saleBeforeApproval = await saleRef.get();
    if (!saleBeforeApproval.exists || saleBeforeApproval.get("organizationId") !== actor.organizationId || saleBeforeApproval.get("branchId") !== initial.get("branchId"))
      throw new HttpsError("failed-precondition", "The original sale is unavailable.");
    const location = cancellation ? await db.doc(`inventoryLocations/${saleBeforeApproval.get("locationId")}`).get() : await branchLocation(
      actor.organizationId,
      String(initial.get("branchId")),
    );
    if (!location.exists || location.get("organizationId") !== actor.organizationId || location.get("branchId") !== initial.get("branchId"))
      throw new HttpsError("failed-precondition", "The original stock location is unavailable.");
    const itemRefs = returnItemsQuery.docs.map((line) =>
      db.doc(`saleItems/${line.get("saleItemId")}`),
    );
    const counterRefs = returnItemsQuery.docs.map((line) =>
      db.doc(
        `saleReturnItemCounters/${returnCounterId(actor.organizationId, String(line.get("saleItemId")))}`,
      ),
    );
    const balanceRefs = returnItemsQuery.docs.map((line) =>
      db.doc(
        `inventoryBalances/${balanceDocumentId(actor.organizationId, String(line.get("productId")), location.id)}`,
      ),
    );
    if (new Set(balanceRefs.map((reference) => reference.path)).size !== balanceRefs.length)
      throw new HttpsError("failed-precondition", "Select each product once per return or cancellation.");
    const customerId = initial.get("customerId")
      ? String(initial.get("customerId"))
      : "no-return-customer-placeholder";
    const customer = db.doc(`customers/${customerId}`);
    const refundShift = db.doc(
      `posShifts/${initial.get("refundShiftId") ?? "no-cash-refund-shift-placeholder"}`,
    );
    const refundBankAccountId = initial.get("bankAccountId") || input.bankAccountId;
    const refundBankAccount = db.doc(`bankAccounts/${refundBankAccountId || "no-bank-account"}`);
    const operation = db.doc(
      `idempotencyKeys/${actor.organizationId}_approveSaleReturn_${input.idempotencyKey}`,
    );
    const inventoryCounter = db.doc(
      `inventoryCounters/${actor.organizationId}_transactions`,
    );
    const journalCounter = db.doc(
      `journalCounters/${uniquenessDocumentId(actor.organizationId, "general")}`,
    );
    const credit = db.collection("salesCredits").doc();
    const refund = db.collection("saleRefunds").doc();
    const inventoryTransaction = db.collection("inventoryTransactions").doc();
    const journal = db.collection("journalEntries").doc();
    const effectiveAt = Timestamp.now();
    const accountingPeriod = accountingPeriodReference(
      actor.organizationId,
      effectiveAt,
    );
    let result = {
      returnId: input.returnId,
      approved: true,
      creditId: null as string | null,
    };
    await db.runTransaction(async (transaction) => {
      const bankAccountSnapshot = await transaction.get(refundBankAccount);
      const snapshots = await transaction.getAll(
        operation,
        returnRef,
        customer,
        refundShift,
        inventoryCounter,
        journalCounter,
        accountingPeriod,
        saleRef,
        ...itemRefs,
        ...counterRefs,
        ...balanceRefs,
      );
      let cursor = 0;
      const previous = snapshots[cursor++]!,
        current = snapshots[cursor++]!,
        customerSnapshot = snapshots[cursor++]!;
      const refundShiftSnapshot = snapshots[cursor++]!;
      const inventoryCounterSnapshot = snapshots[cursor++]!,
        journalCounterSnapshot = snapshots[cursor++]!;
      const accountingPeriodSnapshot = snapshots[cursor++]!;
      const originalSale = snapshots[cursor++]!;
      const originalItems = snapshots.slice(
        cursor,
        (cursor += itemRefs.length),
      );
      const counters = snapshots.slice(cursor, (cursor += counterRefs.length));
      const balances = snapshots.slice(cursor, (cursor += balanceRefs.length));
      if (previous.exists) {
        if (previous.get("entityId") !== input.returnId)
          throw new HttpsError("already-exists", "This retry reference belongs to another return.");
        result = {
          returnId: input.returnId,
          approved: false,
          creditId: previous.get("creditId") ?? null,
        };
        return;
      }
      assertAccountingPeriodOpen(accountingPeriodSnapshot);
      if (!originalSale.exists || originalSale.get("organizationId") !== actor.organizationId || originalSale.get("branchId") !== initial.get("branchId"))
        throw new HttpsError("failed-precondition", "The original sale is unavailable.");
      if (!current.exists || current.get("status") !== "submitted")
        throw new HttpsError(
          "failed-precondition",
          "Only a submitted return can be approved.",
        );
      if (!cancellation && (current.get("inspectionStatus") !== "completed" || current.get("inspectionVersion") !== initial.get("inspectionVersion") || returnItemsQuery.docs.some(line => line.get("inspectionStatus") !== "completed")))
        throw new HttpsError("failed-precondition", "Inspect every returned item before posting. Only items confirmed resellable will return to available stock.");
      if (current.get("createdBy") === actor.userId && !canSelfAuthorize(actor))
        throw new HttpsError(
          "permission-denied",
          "This role cannot approve its own return.",
          { code: "RETURN_SELF_APPROVAL_FORBIDDEN" },
        );
      const saleSerials = await readSaleSerials(transaction, { organizationId: actor.organizationId, locationId: location.id, saleId: String(current.get("saleId")) }, returnItemsQuery.docs.map((line, index) => ({ saleItemId: originalItems[index]!.id, productId: String(originalItems[index]!.get("productId")), trackingType: String(originalItems[index]!.get("trackingType")), quantity: Number(line.get("quantity")), serialNumbers: line.get("serialNumbers") ?? [] })), cancellation ? "cancel" : "return");
      const lines = returnItemsQuery.docs.map((line, index) => {
        const original = originalItems[index]!,
          counter = counters[index]!,
          balance = balances[index]!;
        const quantity = Number(line.get("quantity"));
        const remaining = cancellation
          ? Number(original.get("quantity")) - Number(original.get("collectedQuantity") ?? original.get("quantity")) - Number(original.get("cancelledQuantity") ?? 0)
          : Number(original.get("collectedQuantity") ?? original.get("quantity")) - Number(counter.get("returnedQuantity") ?? 0);
        if (
          !original.exists ||
          original.get("saleId") !== current.get("saleId") ||
          quantity > remaining
        )
          throw new HttpsError(
            "failed-precondition",
            "A return item is no longer fully returnable.",
          );
        if (cancellation && (!balance.exists || balance.get("organizationId") !== actor.organizationId || Number(balance.get("reservedQuantity") ?? 0) < quantity || Number(line.get("costAmountMinor")) !== 0))
          throw new HttpsError("failed-precondition", "The goods are no longer reserved at the original sale location.");
        const reversedQuantity = Number(counter.get("returnedQuantity") ?? 0) + Number(original.get("cancelledQuantity") ?? 0);
        const soldQuantity = Number(original.get("quantity"));
        const originalNet = Number(original.get("netAmountMinor") ?? soldQuantity * Number(original.get("unitPriceMinor")));
        const originalVat = Number(original.get("vatAmountMinor") ?? Math.round(originalNet * Number(original.get("vatRateBasisPoints")) / 10_000));
        const reversedNet = Number(counter.get("reversedNetAmountMinor") ?? Math.round(originalNet * reversedQuantity / soldQuantity));
        const reversedVat = Number(counter.get("reversedVatAmountMinor") ?? Math.round(originalVat * reversedQuantity / soldQuantity));
        if (Number(line.get("netAmountMinor")) !== Math.round(originalNet * (reversedQuantity + quantity) / soldQuantity) - reversedNet || Number(line.get("vatAmountMinor")) !== Math.round(originalVat * (reversedQuantity + quantity) / soldQuantity) - reversedVat)
          throw new HttpsError("failed-precondition", "Another return or cancellation changed this invoice. Review and submit a fresh request before approval.");
        if (!cancellation && original.get("collectionTracked") === true) {
          const returnedCost = Number(counter.get("returnedCostAmountMinor") ?? Math.round(Number(original.get("costAmountMinor")) * Number(counter.get("returnedQuantity") ?? 0) / Number(original.get("collectedQuantity"))));
          if (Number(line.get("costAmountMinor")) > Number(original.get("costAmountMinor")) - returnedCost)
            throw new HttpsError("failed-precondition", "The collection cost changed after this return was requested. Review and submit a fresh return before approval.");
        }
        if (
          line.get("condition") === "restockable" &&
          (!balance.exists ||
            balance.get("organizationId") !== actor.organizationId)
        )
          throw new HttpsError(
            "failed-precondition",
            "The branch stock balance required for restocking is unavailable.",
          );
        if (saleSerials[index]!.length && !cancellation && serialCost(saleSerials[index]!) !== Number(line.get("costAmountMinor")))
          throw new HttpsError("failed-precondition", "Serial cost evidence changed. Review this return before posting.");
        return { line, original, counter, balance, quantity, reversedNet, reversedVat, serials: saleSerials[index]! };
      });
      const gross = Number(current.get("grossAmountMinor")),
        net = Number(current.get("netAmountMinor")),
        vat = Number(current.get("vatAmountMinor"));
      const resolution = String(current.get("resolution"));
      if (
        resolution === "cash" &&
        (!refundShiftSnapshot.exists ||
          refundShiftSnapshot.get("organizationId") !== actor.organizationId ||
          refundShiftSnapshot.get("branchId") !== current.get("branchId") ||
          refundShiftSnapshot.get("status") !== "open")
      )
        throw new HttpsError(
          "failed-precondition",
          "The selected cash-refund POS shift is no longer open.",
        );
      if (resolution === "customer_account") {
        if (
          !customerSnapshot.exists ||
          customerSnapshot.get("organizationId") !== actor.organizationId ||
          Number(customerSnapshot.get("outstandingBalanceMinor") ?? 0) < gross
        )
          throw new HttpsError(
            "failed-precondition",
            "The customer receivable is insufficient for this return credit.",
          );
        const account = selectedArrangement(customerSnapshot.data()!, originalSale.get("customerAccountId") ?? "general", true);
        if (account.outstandingBalanceMinor < gross)
          throw new HttpsError("failed-precondition", "The original customer account has insufficient outstanding debt for this return credit. Choose an authorized refund or exchange instead.");
        if (originalSale.get("receivableVersion") === 1) reduceInvoice(Number(originalSale.get("receivableOutstandingMinor")), gross);
        else if (legacyDebt(account.outstandingBalanceMinor, customerSnapshot.get("invoiceDebtByAccount"), account.id) < gross)
          throw new HttpsError("failed-precondition", "This historical return cannot reduce debt belonging to newer invoices.");
      }
      const restockCost = lines
        .filter((line) => line.line.get("condition") === "restockable")
        .reduce(
          (sum, line) => sum + Number(line.line.get("costAmountMinor")),
          0,
        );
      const hasRestock = lines.some(line => line.line.get("condition") === "restockable");
      if (current.get("bankAccountId") && input.bankAccountId && current.get("bankAccountId") !== input.bankAccountId)
        throw new HttpsError("invalid-argument", "The refund account must match the submitted return.");
      const settlement = resolution === "card" || resolution === "bank_transfer"
        ? resolveSettlementAccount(actor.organizationId, resolution, refundBankAccountId || undefined, bankAccountSnapshot)
        : null;
      const refundAccount = settlement ? { code: settlement.accountCode, name: settlement.accountName } : refundAccounts[resolution]!;
      const journalLines = [
        { accountCode: "4010", debitMinor: net, creditMinor: 0 },
        { accountCode: "2100", debitMinor: vat, creditMinor: 0 },
        { accountCode: refundAccount.code, debitMinor: 0, creditMinor: gross },
        ...(restockCost > 0
          ? [
              { accountCode: "1200", debitMinor: restockCost, creditMinor: 0 },
              { accountCode: "5000", debitMinor: 0, creditMinor: restockCost },
            ]
          : []),
      ].filter((line) => line.debitMinor || line.creditMinor);
      assertBalancedJournal(journalLines);
      const now = FieldValue.serverTimestamp(),
        year = new Date().getUTCFullYear();
      const journalSequence =
        Number(journalCounterSnapshot.get("value") ?? 0) + 1;
      const inventorySequence =
        Number(inventoryCounterSnapshot.get("value") ?? 0) + 1;
      const journalNumber = `JRN-${year}-${String(journalSequence).padStart(6, "0")}`;
      const inventoryNumber = `INV-${year}-${String(inventorySequence).padStart(6, "0")}`;
      transaction.set(journalCounter, {
        organizationId: actor.organizationId,
        kind: "journalEntry",
        value: journalSequence,
        updatedAt: now,
      });
      if (hasRestock || cancellation)
        transaction.set(
          inventoryCounter,
          {
            organizationId: actor.organizationId,
            kind: "inventoryTransaction",
            value: inventorySequence,
            updatedAt: now,
          },
          { merge: true },
        );
      transaction.update(returnRef, {
        bankAccountId: settlement?.bankAccountId ?? null,
        ledgerAccountCode: refundAccount.code,
        status: "approved",
        approvedAt: now,
        approvedBy: actor.userId,
        approvalNotes: input.notes ?? null,
        journalEntryId: journal.id,
        inventoryTransactionId:
          hasRestock || cancellation ? inventoryTransaction.id : null,
        updatedAt: now,
      });
      for (const [index, line] of lines.entries()) {
        const serialNumbers = line.serials.map(serial => String(serial.get("serialNumber")));
        changeSaleSerials(transaction, line.serials, cancellation ? "cancel" : "return", { saleId: String(current.get("saleId")), saleItemId: line.original.id, locationId: location.id, branchId: String(current.get("branchId")), userId: actor.userId, ...(cancellation || line.line.get("condition") === "restockable" ? { movementId: inventoryTransaction.id } : {}), returnId: returnRef.id, resellable: line.line.get("condition") === "restockable" });
        transaction.set(counterRefs[index]!, {
          organizationId: actor.organizationId,
          saleId: current.get("saleId"),
          saleItemId: line.original.id,
          reversedNetAmountMinor: line.reversedNet + Number(line.line.get("netAmountMinor")),
          reversedVatAmountMinor: line.reversedVat + Number(line.line.get("vatAmountMinor")),
          updatedAt: now,
        }, { merge: true });
        if (cancellation) {
          const reserved = Number(line.balance.get("reservedQuantity"));
          const physical = Number(line.balance.get("onHandQuantity"));
          transaction.update(itemRefs[index]!, { cancelledQuantity: Number(line.original.get("cancelledQuantity") ?? 0) + line.quantity, updatedAt: now });
          transaction.update(balanceRefs[index]!, { reservedQuantity: reserved - line.quantity, availableQuantity: physical - reserved + line.quantity, lastTransactionId: inventoryTransaction.id, lastMovementAt: effectiveAt, version: Number(line.balance.get("version") ?? 0) + 1, updatedAt: now });
          if (serialNumbers.length) {
            transaction.update(itemRefs[index]!, { cancelledSerialNumbers: FieldValue.arrayUnion(...serialNumbers) });
            writeSaleSerialEntries(transaction, line.serials, { organizationId: actor.organizationId, productId: line.original.get("productId"), productName: line.original.get("productName"), sku: line.original.get("sku"), transactionId: inventoryTransaction.id, transactionNumber: inventoryNumber, transactionType: "sale_reservation_release", currency: "NGN", effectiveAt, createdAt: now, postedBy: actor.userId, referenceNumber: current.get("returnNumber"), reason: "Cancelled uncollected serialized goods" }, { locationId: location.id, branchId: String(current.get("branchId")), balanceBefore: physical, direction: 0, reservedDirection: -1 });
            continue;
          }
          transaction.create(db.collection("inventoryEntries").doc(), { organizationId: actor.organizationId, branchId: current.get("branchId"), locationId: location.id, productId: line.original.get("productId"), productName: line.original.get("productName"), sku: line.original.get("sku"), trackingType: "quantity", transactionId: inventoryTransaction.id, transactionNumber: inventoryNumber, transactionType: "sale_reservation_release", quantityDelta: 0, reservedQuantityDelta: -line.quantity, valueDeltaMinor: 0, unitCostMinor: 0, currency: "NGN", balanceBefore: physical, balanceAfter: physical, effectiveAt, createdAt: now, postedBy: actor.userId, referenceNumber: current.get("returnNumber"), reason: "Cancelled uncollected goods; physical stock never left" });
          continue;
        }
        transaction.set(
          counterRefs[index]!,
          {
            organizationId: actor.organizationId,
            saleId: current.get("saleId"),
            saleItemId: line.original.id,
            returnedQuantity:
              Number(line.counter.get("returnedQuantity") ?? 0) + line.quantity,
            ...(serialNumbers.length ? { returnedSerialNumbers: FieldValue.arrayUnion(...serialNumbers) } : {}),
            returnedCostAmountMinor: Number(line.counter.get("returnedCostAmountMinor") ?? Math.round(Number(line.original.get("costAmountMinor") ?? 0) * Number(line.counter.get("returnedQuantity") ?? 0) / Number(line.original.get("collectedQuantity") ?? line.original.get("quantity")))) + Number(line.line.get("costAmountMinor")),
            updatedAt: now,
          },
          { merge: true },
        );
        if (line.line.get("condition") !== "restockable") continue;
        const beforeQuantity = Number(line.balance.get("onHandQuantity")),
          beforeValue = Number(line.balance.get("totalValueMinor") ?? 0);
        const nextQuantity = beforeQuantity + line.quantity,
          nextValue = beforeValue + Number(line.line.get("costAmountMinor"));
        transaction.update(balanceRefs[index]!, {
          onHandQuantity: nextQuantity,
          availableQuantity:
            nextQuantity - Number(line.balance.get("reservedQuantity") ?? 0),
          totalValueMinor: nextValue,
          averageUnitCostMinor: nextQuantity
            ? Math.round(nextValue / nextQuantity)
            : 0,
          lastTransactionId: inventoryTransaction.id,
          lastMovementAt: effectiveAt,
          version: Number(line.balance.get("version") ?? 0) + 1,
          updatedAt: now,
        });
        const base = {
          organizationId: actor.organizationId,
          transactionId: inventoryTransaction.id,
          transactionNumber: inventoryNumber,
          transactionType: "sale_return",
          productId: line.line.get("productId"),
          sku: line.line.get("sku"),
          productName: line.line.get("productName"),
          trackingType: "quantity",
          unitCostMinor: line.line.get("unitCostMinor"),
          currency: "NGN",
          effectiveAt,
          postedBy: actor.userId,
          reason: `Approved sale return ${current.get("returnNumber")}`,
          referenceNumber: current.get("returnNumber"),
          createdAt: now,
        };
        if (line.serials.length) {
          writeSaleSerialEntries(transaction, line.serials, base, { locationId: location.id, branchId: String(current.get("branchId")), balanceBefore: beforeQuantity, direction: 1, externalAccount: "customer_returns" });
          continue;
        }
        transaction.create(db.collection("inventoryEntries").doc(), {
          ...base,
          locationId: location.id,
          branchId: current.get("branchId"),
          quantityDelta: line.quantity,
          valueDeltaMinor: line.line.get("costAmountMinor"),
          balanceBefore: beforeQuantity,
          balanceAfter: nextQuantity,
        });
        transaction.create(db.collection("inventoryEntries").doc(), {
          ...base,
          externalAccount: "customer_returns",
          counterpartyLocationId: location.id,
          quantityDelta: -line.quantity,
          valueDeltaMinor: -Number(line.line.get("costAmountMinor")),
          balanceBefore: 0,
          balanceAfter: 0,
        });
      }
      if (cancellation) {
        const cancelledQuantity = Number(originalSale.get("cancelledQuantity") ?? 0) + lines.reduce((sum, line) => sum + line.quantity, 0);
        const collected = Number(originalSale.get("collectedQuantity") ?? 0);
        const remaining = Number(originalSale.get("totalQuantity")) - cancelledQuantity - collected;
        transaction.update(saleRef, { cancelledQuantity, collectionStatus: remaining > 0 ? (collected > 0 ? "partially_collected" : "awaiting_collection") : (collected > 0 ? "collected" : "cancelled"), updatedAt: now });
      }
      if (hasRestock || cancellation)
        transaction.create(inventoryTransaction, {
          organizationId: actor.organizationId,
          transactionNumber: inventoryNumber,
          transactionType: cancellation ? "sale_reservation_release" : "sale_return",
          status: "posted",
          referenceType: "saleReturn",
          referenceId: returnRef.id,
          referenceNumber: current.get("returnNumber"),
          destinationLocationId: location.id,
          destinationBranchId: current.get("branchId"),
          effectiveAt,
          postedAt: now,
          postedBy: actor.userId,
          reason: cancellation ? "Approved cancellation of uncollected goods" : "Approved customer return",
          correlationId: correlationId(),
          createdAt: now,
          createdBy: actor.userId,
        });
      if (resolution === "exchange_credit") {
        transaction.create(credit, {
          organizationId: actor.organizationId,
          branchId: current.get("branchId"),
          returnId: returnRef.id,
          saleId: current.get("saleId"),
          creditNumber: `EXC-${String(current.get("returnNumber")).replace(/^RTN-/, "")}`,
          customerId: current.get("customerId") ?? null,
          originalAmountMinor: gross,
          remainingAmountMinor: gross,
          status: "active",
          currency: "NGN",
          createdAt: now,
          createdBy: actor.userId,
        });
        transaction.update(returnRef, { exchangeCreditId: credit.id });
        result.creditId = credit.id;
      } else if (resolution === "customer_account") {
        const outstanding = Number(
            customerSnapshot.get("outstandingBalanceMinor"),
          ),
          next = outstanding - gross,
          limit = Number(customerSnapshot.get("creditLimitMinor") ?? 0);
        transaction.update(customer, {
          arrangements: changeArrangementBalance(customerSnapshot.data()!, [{ accountId: originalSale.get("customerAccountId") ?? "general", amountMinor: -gross }]),
          ...(originalSale.get("receivableVersion") === 1 ? { invoiceDebtByAccount: changeMoneyBalance(customerSnapshot.get("invoiceDebtByAccount"), originalSale.get("customerAccountId") ?? "general", -gross) } : {}),
          outstandingBalanceMinor: next,
          availableCreditMinor:
            customerSnapshot.get("creditStatus") === "approved"
              ? Math.max(0, limit - next)
              : 0,
          updatedAt: now,
          updatedBy: actor.userId,
        });
        if (originalSale.get("receivableVersion") === 1) transaction.update(originalSale.ref, { ...reduceInvoice(Number(originalSale.get("receivableOutstandingMinor")), gross), receivableCreditedMinor: Number(originalSale.get("receivableCreditedMinor") ?? 0) + gross, receivableUpdatedAt: now });
        transaction.create(db.collection("customerAccountEntries").doc(), {
          organizationId: actor.organizationId,
          branchId: current.get("branchId"),
          customerId: customer.id,
          entryType: "sale_return_credit",
          customerAccountId: originalSale.get("customerAccountId") ?? "general",
          customerAccountName: originalSale.get("customerAccountName") ?? "General account",
          referenceType: "saleReturn",
          referenceId: returnRef.id,
          referenceNumber: current.get("returnNumber"),
          amountMinor: -gross,
          balanceAfterMinor: next,
          currency: "NGN",
          effectiveAt,
          createdAt: now,
          createdBy: actor.userId,
        });
      } else {
        if (resolution === "cash")
          transaction.update(refundShift, {
            cashRefundsMinor:
              Number(refundShiftSnapshot.get("cashRefundsMinor") ?? 0) + gross,
            updatedAt: now,
          });
        transaction.create(refund, {
          organizationId: actor.organizationId,
          branchId: current.get("branchId"),
          returnId: returnRef.id,
          saleId: current.get("saleId"),
          refundNumber: `RFD-${String(current.get("returnNumber")).replace(/^RTN-/, "")}`,
          method: resolution,
          bankAccountId: settlement?.bankAccountId ?? null,
          bankName: settlement?.bankName ?? null,
          bankAccountName: settlement?.bankAccountName ?? null,
          accountNumberLast4: settlement?.accountNumberLast4 ?? null,
          ledgerAccountCode: refundAccount.code,
          journalEntryId: journal.id,
          shiftId: resolution === "cash" ? refundShift.id : null,
          amountMinor: gross,
          status: "recorded",
          currency: "NGN",
          recordedAt: now,
          recordedBy: actor.userId,
          createdAt: now,
        });
      }
      transaction.create(journal, {
        organizationId: actor.organizationId,
        branchId: current.get("branchId"),
        journalNumber,
        journalType: "sale_return",
        status: "posted",
        referenceType: "saleReturn",
        referenceId: returnRef.id,
        referenceNumber: current.get("returnNumber"),
        description: `Sale return ${current.get("returnNumber")}`,
        totalDebitMinor: journalLines.reduce(
          (sum, line) => sum + line.debitMinor,
          0,
        ),
        totalCreditMinor: journalLines.reduce(
          (sum, line) => sum + line.creditMinor,
          0,
        ),
        currency: "NGN",
        effectiveAt,
        postedAt: now,
        postedBy: actor.userId,
        createdAt: now,
      });
      for (const line of journalLines) {
        const account = db.doc(
          `chartOfAccounts/${uniquenessDocumentId(actor.organizationId, line.accountCode)}`,
        );
        transaction.set(
          account,
          {
            organizationId: actor.organizationId,
            code: line.accountCode,
            name: accountNames[line.accountCode] ?? refundAccount.name,
            currency: "NGN",
            active: true,
            systemManaged: true,
            updatedAt: now,
          },
          { merge: true },
        );
        transaction.create(db.collection("journalLines").doc(), {
          organizationId: actor.organizationId,
          branchId: current.get("branchId"),
          journalEntryId: journal.id,
          journalNumber,
          accountId: account.id,
          accountCode: line.accountCode,
          accountName: accountNames[line.accountCode] ?? refundAccount.name,
          debitMinor: line.debitMinor,
          creditMinor: line.creditMinor,
          currency: "NGN",
          effectiveAt,
          createdAt: now,
        });
      }
      transaction.create(
        operation,
        clean({
          organizationId: actor.organizationId,
          action: "approveSaleReturn",
          entityId: returnRef.id,
          creditId: result.creditId,
          status: "completed",
          createdAt: now,
          createdBy: actor.userId,
        }),
      );
      writeAuditLog(transaction, actor, {
        action: cancellation ? "sale.reservation_cancelled" : "sale_return.approved",
        entityType: "saleReturn",
        entityId: returnRef.id,
        correlationId: correlationId(),
        sourceFunction: "approveSaleReturn",
        reason: String(current.get("reason")),
        after: {
          resolution,
          grossAmountMinor: gross,
          restockCostMinor: restockCost,
          inspectionStatus: current.get("inspectionStatus") ?? "not_required",
          bankAccountId: settlement?.bankAccountId ?? null,
          ledgerAccountCode: refundAccount.code,
        },
      });
    });
    return result;
  },
);

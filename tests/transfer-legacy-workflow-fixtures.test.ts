import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessProfile } from "../functions/src/auth/authorize";
import { Timestamp } from "firebase-admin/firestore";
import type { InventoryPostingExtension, PostingRequest } from "../functions/src/inventory/post-inventory-transaction";
import { TransferFirestoreFixture } from "./helpers/transfer-firestore-fixture";

const state = vi.hoisted(() => ({ db: null as unknown as TransferFirestoreFixture, post: vi.fn(), failBeforeProduct: "", failAfterProduct: "", actor: null as unknown as AccessProfile }));
vi.mock("../functions/src/admin.js", () => ({ db: {
  doc: (path: string) => state.db.doc(path),
  collection: (path: string) => state.db.collection(path),
  getAll: (...refs: Parameters<TransferFirestoreFixture["getAll"]>) => state.db.getAll(...refs),
  runTransaction: (handler: Parameters<TransferFirestoreFixture["runTransaction"]>[0]) => state.db.runTransaction(handler),
} }));
vi.mock("../functions/src/auth/authorize.js", async importOriginal => ({
  ...await importOriginal<typeof import("../functions/src/auth/authorize")>(),
  requireAccess: async (): Promise<AccessProfile> => state.actor,
}));
vi.mock("../functions/src/config.js", () => ({ enforceAppCheck: false }));
vi.mock("../functions/src/inventory/post-inventory-transaction.js", () => ({ postInventoryTransaction: state.post }));
vi.mock("../functions/src/transfers/validate-transfer-invariants.js", () => ({ assertTransferInvariantGate: vi.fn() }));
import { cancelTransfer, confirmTransferDispatch, confirmTransferReceipt, updateTransferDraft } from "../functions/src/callable/transfers";
import { reserveTransferStockService, releaseTransferReservationService } from "../functions/src/transfers/reservation-service";
import { balanceDocumentId } from "../functions/src/inventory/calculations";
import * as legacy from "../functions/src/callable/transfers";
import { accessProfileFromRecord, type Permission, type RoleId } from "../functions/src/auth/authorize";
import { buildRoleAssignment, type StoredRole } from "../functions/src/auth/custom-roles";
import { transferCommandRef } from "../functions/src/transfers/command-security";

beforeEach(() => {
  state.db = new TransferFirestoreFixture();
  state.actor = { userId: "manager", organizationId: "org", roleId: "warehouse_manager", roleIds: ["warehouse_manager"], branchIds: [], warehouseIds: ["warehouse"], authorizationVersion: 1 };
  state.post.mockReset();
  state.failBeforeProduct = "";
  state.failAfterProduct = "";
  // Models the posting service's documented atomic extension contract, not its
  // stock engine. Failure injection exercises actual transfer orchestration.
  state.post.mockImplementation(async (_actor, input: PostingRequest, extension?: InventoryPostingExtension<unknown>) => {
    if (state.failBeforeProduct === input.productId) { state.failBeforeProduct = ""; throw new Error("Injected failure before stock commit"); }
    const result = await state.db.runTransaction(async tx => {
      const operation = state.db.doc(`fixturePostingKeys/${input.idempotencyKey}`);
      const previous = await tx.get(operation);
      if (previous.exists) return { transactionId: previous.get("transactionId"), posted: false };
      const suffix = input.productId === "product" ? "" : `_${input.productId}`;
      const sourceRef = state.db.doc(`fixtureStock/${input.sourceLocationId}${suffix}`);
      const targetRef = state.db.doc(`fixtureStock/${input.destinationLocationId}${suffix}`);
      const [source, target] = await tx.getAll(sourceRef, targetRef);
      if (Number(source!.get("quantity")) < input.quantity) throw new Error("Insufficient fixture stock");
      const balanceRef = state.db.doc(`inventoryBalances/${balanceDocumentId("org", input.productId, input.sourceLocationId!, input.lotId)}`);
      const balance = await tx.get(balanceRef);
      const transactionId = `movement-${crypto.randomUUID()}`;
      const context = { transactionId, transactionNumber: transactionId, productId: input.productId, quantity: input.quantity,
        movementValueMinor: input.quantity * 100, movementUnitCostMinor: 100, effectiveAt: Timestamp.fromDate(new Date(input.effectiveAt)) };
      const prepared = await extension?.prepare(tx as never, context);
      tx.update(sourceRef, { quantity: Number(source!.get("quantity")) - input.quantity });
      tx.set(targetRef, { quantity: Number(target!.get("quantity") ?? 0) + input.quantity });
      if (balance.exists) {
        const held = Number(balance.get("reservedQuantity") ?? 0) - (input.transferContext?.consumeReservedQuantity ?? 0);
        const onHand = Number(balance.get("onHandQuantity")) - input.quantity;
        if (held < 0 || onHand < held) throw new Error("Insufficient reserved fixture stock");
        tx.update(balanceRef, { onHandQuantity: onHand, reservedQuantity: held, availableQuantity: onHand - held });
      }
      tx.create(state.db.doc(`inventoryTransactions/${transactionId}`), { organizationId: "org", referenceId: input.referenceId, quantity: input.quantity });
      tx.create(operation, { transactionId });
      extension?.apply(tx as never, prepared, context);
      return { transactionId, posted: true };
    });
    if (state.failAfterProduct === input.productId) { state.failAfterProduct = ""; throw new Error("Injected lost response after stock commit"); }
    return result;
  });
});

function seedDispatch(products = ["product", "other"]) {
  state.db.seed("transfers/transfer", { organizationId: "org", originWarehouseId: "warehouse", originLocationId: "source", transitLocationId: "transit", destinationLocationId: "destination", damagedLocationId: "damaged", destinationBranchId: "branch", version: 1, status: "ready_for_dispatch", totalApprovedQuantity: products.length * 2, totalReservedQuantity: products.length * 2 });
  const packageIds = products.map(product => `package-${product}`);
  state.db.seed("transferDispatches/dispatch", { organizationId: "org", transferId: "transfer", dispatchNumber: "DSP", status: "draft", packageIds, quantity: products.length * 2, dispatchedBy: "manager" });
  for (const product of products) {
    state.db.seed(`transferItems/${product}`, { organizationId: "org", transferId: "transfer", productId: product, sku: product, trackingType: "quantity", approvedQuantity: 2, reservedQuantity: 2, dispatchedQuantity: 0 });
    state.db.seed(`stockReservations/transfer__${product}`, { organizationId: "org", transferId: "transfer", transferItemId: product, productId: product, sourceLocationId: "source", quantity: 2, remainingQuantity: 2, consumedQuantity: 0, releasedQuantity: 0, lotAllocations: [], serialItemIds: [], status: "active" });
    state.db.seed(`transferPackages/package-${product}`, { organizationId: "org", transferId: "transfer", status: "sealed", quantity: 2 });
    state.db.seed(`transferPackageItems/package-${product}`, { organizationId: "org", transferId: "transfer", packageId: `package-${product}`, transferItemId: product, productId: product, quantity: 2, serialItemIds: [], lotAllocations: [] });
    state.db.seed(`fixtureStock/source${product === "product" ? "" : `_${product}`}`, { quantity: 2 });
    state.db.seed(`inventoryBalances/${balanceDocumentId("org", product, "source")}`, { organizationId: "org", productId: product, locationId: "source", onHandQuantity: 2, reservedQuantity: 2, availableQuantity: 0 });
  }
  return { transferId: "transfer", dispatchId: "dispatch", packageIds, expectedVersion: 1, driverName: "Fixture driver", idempotencyKey: crypto.randomUUID() };
}
const dispatch = (data: ReturnType<typeof seedDispatch>) => confirmTransferDispatch.run({ data } as Parameters<typeof confirmTransferDispatch.run>[0]);
const cancellation = (version = 1) => cancelTransfer.run({ data: { transferId: "transfer", expectedVersion: version, reason: "Fixture cancellation", idempotencyKey: crypto.randomUUID() } } as Parameters<typeof cancelTransfer.run>[0]);
function receiptLine(product = "product", received = 2) {
  return { transferItemId: product, receivedQuantity: received, damagedQuantity: 0, rejectedQuantity: 0, missingQuantity: 0, serialItemIds: [] as string[], damagedSerialItemIds: [] as string[], lotAllocations: [] as { lotId: string; quantity: number; disposition: "received" | "damaged" }[] };
}
function seedReceipt(lines = [receiptLine(), receiptLine("other")], id = "receipt") {
  state.actor = { userId: "receiver", organizationId: "org", roleId: "branch_manager", roleIds: ["branch_manager"], branchIds: ["branch"], warehouseIds: [], authorizationVersion: 1 };
  state.db.seed(`transferReceipts/${id}`, { organizationId: "org", transferId: "transfer", dispatchId: "dispatch", receiptNumber: id, status: "draft", lines });
  return { transferId: "transfer", dispatchId: "dispatch", receiptId: id, expectedVersion: 1, deliveryCondition: "good", lines, idempotencyKey: crypto.randomUUID() };
}
const receive = (data: ReturnType<typeof seedReceipt>) => confirmTransferReceipt.run({ data } as Parameters<typeof confirmTransferReceipt.run>[0]);

describe("recoverable legacy stock execution", () => {
  it.each(["before", "after"])("recovers after a failure %s a movement commit without repeating stock", async phase => {
    const data = seedDispatch();
    if (phase === "before") state.failBeforeProduct = "product"; else state.failAfterProduct = "other";
    // Sorted item order is other, product. Both cases retain one committed line.
    await expect(dispatch(data)).rejects.toThrow("Injected");
    expect(state.db.all("inventoryTransactions")).toHaveLength(1);
    expect(state.db.row("transfers/transfer")).toHaveProperty("activeStockExecutionId");
    expect(state.db.row("transferDispatches/dispatch").status).toBe("draft");
    await expect(cancellation()).rejects.toMatchObject({ code: "failed-precondition" });
    await expect(dispatch({ ...data, idempotencyKey: crypto.randomUUID() })).resolves.toMatchObject({ confirmed: true });
    expect(state.db.all("inventoryTransactions")).toHaveLength(2);
    expect(state.db.row("fixtureStock/transit").quantity).toBe(2);
    expect(state.db.row("fixtureStock/transit_other").quantity).toBe(2);
    expect(state.db.row("transfers/transfer")).not.toHaveProperty("activeStockExecutionId");
  });

  it("serializes different confirmation keys for the same dispatch and finalizes once", async () => {
    const data = seedDispatch();
    const outcomes = await Promise.all([dispatch(data), dispatch({ ...data, idempotencyKey: crypto.randomUUID() })]);
    expect(outcomes.filter(result => result.confirmed)).toHaveLength(1);
    expect(state.db.all("inventoryTransactions")).toHaveLength(2);
    expect(state.db.row("transfers/transfer")).toMatchObject({ totalDispatchedQuantity: 4, totalReservedQuantity: 0 });
    expect(state.db.all("transferDispatchItems")).toHaveLength(2);
  });

  it("recovers a receipt after stock commit and freezes its original quantities", async () => {
    await dispatch(seedDispatch());
    const data = seedReceipt();
    state.failAfterProduct = "product";
    await expect(receive(data)).rejects.toThrow("Injected");
    expect(state.db.row("fixtureStock/destination").quantity).toBe(2);
    expect(state.db.all("dispatchReceiptBalances")).toHaveLength(0);
    await expect(receive({ ...data, idempotencyKey: crypto.randomUUID(), lines: [receiptLine("product", 1), receiptLine("other")] })).rejects.toMatchObject({ code: "failed-precondition" });
    await expect(receive({ ...data, idempotencyKey: crypto.randomUUID() })).resolves.toMatchObject({ confirmed: true });
    expect(state.db.all("inventoryTransactions")).toHaveLength(4);
    expect(state.db.row("transfers/transfer")).toMatchObject({ status: "received", totalReceivedQuantity: 4 });
    expect(state.db.row("fixtureStock/destination_other").quantity).toBe(2);
    expect(state.db.all("transferReceiptItems")).toHaveLength(2);
  });

  it("rejects over-receipt against the selected dispatch despite larger aggregate dispatched quantity", async () => {
    await dispatch(seedDispatch(["product"]));
    state.db.seed("transferItems/product", { ...state.db.row("transferItems/product"), approvedQuantity: 10, dispatchedQuantity: 10 });
    const data = seedReceipt([receiptLine("product", 3)]);
    await expect(receive(data)).rejects.toMatchObject({ code: "failed-precondition" });
    expect(state.db.all("inventoryTransactions")).toHaveLength(1);
    expect(state.db.all("dispatchReceiptBalances")).toHaveLength(0);
    expect(state.db.row("transfers/transfer")).not.toHaveProperty("activeStockExecutionId");
  });

  it("rejects serial identities belonging to a different dispatch", async () => {
    const data = seedDispatch(["product"]);
    state.db.seed("transferItems/product", { ...state.db.row("transferItems/product"), trackingType: "serial" });
    state.db.seed("transferPackageItems/package-product", { ...state.db.row("transferPackageItems/package-product"), serialItemIds: ["one", "two"] });
    state.db.seed("stockReservations/transfer__product", { ...state.db.row("stockReservations/transfer__product"), serialItemIds: ["one", "two"] });
    for (const id of ["one", "two"]) state.db.seed(`serializedItems/${id}`, { organizationId: "org", productId: "product", serialNumber: id });
    await dispatch(data);
    const line = { ...receiptLine("product", 1), serialItemIds: ["foreign-serial"] };
    await expect(receive(seedReceipt([line]))).rejects.toMatchObject({ code: "failed-precondition" });
    expect(state.db.all("inventoryTransactions")).toHaveLength(1);
  });

  it("routes untracked historical postings and ambiguous lot claims to review", async () => {
    const data = seedDispatch(["product"]);
    state.db.seed("inventoryTransactions/old", { organizationId: "org", referenceId: "dispatch", quantity: 1 });
    await expect(dispatch(data)).rejects.toMatchObject({ details: { code: "TRANSFER_STOCK_REVIEW_REQUIRED" } });
    expect(state.post).not.toHaveBeenCalled();
    expect(state.db.row("transfers/transfer")).not.toHaveProperty("activeStockExecutionId");
  });

  it("retries receipt finalization without repeating stock, claims or request fulfilment", async () => {
    await dispatch(seedDispatch(["product"]));
    state.db.seed("transfers/transfer", { ...state.db.row("transfers/transfer"), sourceType: "branch_request", sourceRequestId: "request" });
    state.db.seed("transferItems/product", { ...state.db.row("transferItems/product"), sourceRequestItemId: "request-item", requestAllocatedQuantity: 2 });
    state.db.seed("branchRequests/request", { organizationId: "org", branchId: "branch", status: "approved", totalApprovedQuantity: 2, totalFulfilledQuantity: 0 });
    state.db.seed("branchRequestItems/request-item", { organizationId: "org", requestId: "request", productId: "product", approvedQuantity: 2, fulfilledQuantity: 0, transferAllocatedQuantity: 2 });
    const data = seedReceipt([receiptLine()]);
    state.db.failNextCommitFor = "transferReceipts/";
    await expect(receive(data)).rejects.toThrow("Injected transaction-finalization");
    expect(state.db.row("fixtureStock/destination").quantity).toBe(2);
    expect(state.db.row("branchRequestItems/request-item")).toMatchObject({ fulfilledQuantity: 0, transferAllocatedQuantity: 2 });
    expect(state.db.all("dispatchReceiptBalances")).toHaveLength(0);
    await expect(receive({ ...data, idempotencyKey: crypto.randomUUID() })).resolves.toMatchObject({ confirmed: true });
    expect(state.db.all("inventoryTransactions")).toHaveLength(2);
    expect(state.db.row("branchRequestItems/request-item")).toMatchObject({ fulfilledQuantity: 2, transferAllocatedQuantity: 0 });
    expect(state.db.row("transferItems/product").requestAllocatedQuantity).toBe(0);
    expect(state.db.all("requestFulfilments")).toHaveLength(1);
  });

  it("prevents competing receipt documents from claiming the same dispatch units", async () => {
    await dispatch(seedDispatch(["product"]));
    const first = seedReceipt([receiptLine()], "receipt-one");
    const second = seedReceipt([receiptLine()], "receipt-two");
    const results = await Promise.allSettled([receive(first), receive(second)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(state.db.all("inventoryTransactions")).toHaveLength(2);
    expect(state.db.row("fixtureStock/destination").quantity).toBe(2);
  });

  it("allows either cancellation or dispatch to win without releasing stock after it departed", async () => {
    const data = seedDispatch();
    const results = await Promise.allSettled([dispatch(data), cancellation()]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const completed = state.db.row("transfers/transfer").status === "dispatched";
    expect(state.db.all("inventoryTransactions")).toHaveLength(completed ? 2 : 0);
    for (const product of ["product", "other"]) {
      expect(state.db.row(`inventoryBalances/${balanceDocumentId("org", product, "source")}`)).toMatchObject({ onHandQuantity: completed ? 0 : 2, reservedQuantity: 0 });
    }
  });

  it("chunks a serialized dispatch and recovers a lost response without losing identities", async () => {
    const data = seedDispatch(["product"]);
    const serialItemIds = Array.from({ length: 120 }, (_, index) => `serial-${index}`);
    state.db.seed("transfers/transfer", { ...state.db.row("transfers/transfer"), totalApprovedQuantity: 120, totalReservedQuantity: 120 });
    state.db.seed("transferDispatches/dispatch", { ...state.db.row("transferDispatches/dispatch"), quantity: 120 });
    state.db.seed("transferItems/product", { ...state.db.row("transferItems/product"), trackingType: "serial", approvedQuantity: 120, reservedQuantity: 120 });
    state.db.seed("stockReservations/transfer__product", { ...state.db.row("stockReservations/transfer__product"), quantity: 120, remainingQuantity: 120, serialItemIds });
    state.db.seed("transferPackages/package-product", { ...state.db.row("transferPackages/package-product"), quantity: 120 });
    state.db.seed("transferPackageItems/package-product", { ...state.db.row("transferPackageItems/package-product"), quantity: 120, serialItemIds });
    for (const id of serialItemIds) state.db.seed(`serializedItems/${id}`, { organizationId: "org", productId: "product", serialNumber: id });
    state.db.seed("fixtureStock/source", { quantity: 120 });
    state.db.seed(`inventoryBalances/${balanceDocumentId("org", "product", "source")}`, { onHandQuantity: 120, reservedQuantity: 120 });
    state.failAfterProduct = "product";
    await expect(dispatch(data)).rejects.toThrow("Injected");
    expect(state.db.row("fixtureStock/transit").quantity).toBe(50);
    await dispatch({ ...data, idempotencyKey: crypto.randomUUID() });
    expect(state.db.row("fixtureStock/transit").quantity).toBe(120);
    expect(state.db.all("inventoryTransactions")).toHaveLength(3);
    expect(state.post.mock.calls.every(call => (call[1] as PostingRequest).serialNumbers.length <= 50)).toBe(true);
    expect(state.db.row("transferDispatchItems/dispatch__product").serialItemIds).toHaveLength(120);
  });

  it("requires request ownership evidence before moving receipt stock", async () => {
    await dispatch(seedDispatch(["product"]));
    state.db.seed("transfers/transfer", { ...state.db.row("transfers/transfer"), sourceType: "branch_request", sourceRequestId: "request" });
    state.db.seed("transferItems/product", { ...state.db.row("transferItems/product"), sourceRequestItemId: "request-item" });
    state.db.seed("branchRequests/request", { organizationId: "org", branchId: "branch", totalApprovedQuantity: 2, totalFulfilledQuantity: 0 });
    state.db.seed("branchRequestItems/request-item", { organizationId: "org", requestId: "request", productId: "product", approvedQuantity: 2, fulfilledQuantity: 0, transferAllocatedQuantity: 2 });
    await expect(receive(seedReceipt([receiptLine()]))).rejects.toMatchObject({ details: { code: "TRANSFER_STOCK_REVIEW_REQUIRED" } });
    expect(state.db.all("inventoryTransactions")).toHaveLength(1);
    expect(state.db.row("transfers/transfer")).not.toHaveProperty("activeStockExecutionId");
  });

  it("checks lot ownership after a partial receipt against that dispatch's remaining lot", async () => {
    const data = seedDispatch(["product"]);
    state.db.seed("transferItems/product", { ...state.db.row("transferItems/product"), trackingType: "batch" });
    const lots = [{ lotId: "lot-a", quantity: 2 }];
    state.db.seed("transferPackageItems/package-product", { ...state.db.row("transferPackageItems/package-product"), lotAllocations: lots });
    state.db.seed("stockReservations/transfer__product", { ...state.db.row("stockReservations/transfer__product"), lotAllocations: lots, remainingLotAllocations: lots, allocationVersion: 2 });
    state.db.rows.delete(`inventoryBalances/${balanceDocumentId("org", "product", "source")}`);
    state.db.seed(`inventoryBalances/${balanceDocumentId("org", "product", "source", "lot-a")}`, { onHandQuantity: 2, reservedQuantity: 2 });
    await dispatch(data);
    const line = { ...receiptLine("product", 1), lotAllocations: [{ lotId: "lot-a", quantity: 1, disposition: "received" as const }] };
    await receive(seedReceipt([line], "first-receipt"));
    await expect(receive(seedReceipt([{ ...line, lotAllocations: [{ lotId: "lot-b", quantity: 1, disposition: "received" }] }], "second-receipt"))).rejects.toMatchObject({ code: "failed-precondition" });
    expect(state.db.all("inventoryTransactions")).toHaveLength(2);
    expect(state.db.row("fixtureStock/transit").quantity).toBe(1);
  });

  it("blocks untracked discrepancy dispositions and duplicate package identities", async () => {
    const data = seedDispatch(["product"]);
    await expect(dispatch({ ...data, packageIds: ["package-product", "package-product"] })).rejects.toMatchObject({ code: "invalid-argument" });
    state.db.seed("transferDiscrepancies/discrepancy", { transferId: "transfer", dispatchId: "dispatch", status: "open", resolutionInProgress: true });
    await expect(dispatch(data)).rejects.toMatchObject({ details: { code: "TRANSFER_STOCK_REVIEW_REQUIRED" } });
    expect(state.db.all("inventoryTransactions")).toHaveLength(0);
    state.db.rows.delete("transferDiscrepancies/discrepancy");
    await dispatch(data);
    state.db.seed("transferDiscrepancies/discrepancy", { transferId: "transfer", dispatchId: "dispatch", status: "resolved", resolutionType: "delivered_later", type: "missing_quantity" });
    await expect(receive(seedReceipt([receiptLine()]))).rejects.toMatchObject({ details: { code: "TRANSFER_STOCK_REVIEW_REQUIRED" } });
    expect(state.db.all("inventoryTransactions")).toHaveLength(1);
  });
});

function seedLotRemainder(exact = true) {
  state.db.seed("transfers/transfer", { organizationId: "org", originWarehouseId: "warehouse", originLocationId: "source", destinationBranchId: "branch", version: 1, status: "partially_dispatched", totalApprovedQuantity: 4, totalDispatchedQuantity: 2, totalReservedQuantity: 2 });
  state.db.seed("transferItems/product", { organizationId: "org", transferId: "transfer", productId: "product", trackingType: "batch", sku: "LOT", approvedQuantity: 4, reservedQuantity: 4, dispatchedQuantity: 2 });
  state.db.seed("stockReservations/transfer__product", { organizationId: "org", transferId: "transfer", transferItemId: "product", productId: "product", sourceLocationId: "source", quantity: 4, remainingQuantity: 2, consumedQuantity: 2, releasedQuantity: 0, lotAllocations: [{ lotId: "lot-a", quantity: 2 }, { lotId: "lot-b", quantity: 2 }], ...(exact ? { allocationVersion: 2, remainingLotAllocations: [{ lotId: "lot-b", quantity: 2 }] } : {}), serialItemIds: [], status: "partially_consumed" });
  for (const [lot, quantity] of [["lot-a", 0], ["lot-b", 2]] as const)
    state.db.seed(`inventoryBalances/${balanceDocumentId("org", "product", "source", lot)}`, { organizationId: "org", productId: "product", locationId: "source", lotId: lot, onHandQuantity: quantity, reservedQuantity: quantity, availableQuantity: 0, version: 0 });
}

describe("exact reservation release and request ownership", () => {
  it("releases lot B after lot A departed, without touching lot A", async () => {
    seedLotRemainder();
    await expect(cancellation()).resolves.toMatchObject({ remainingCancelled: true });
    expect(state.db.row(`inventoryBalances/${balanceDocumentId("org", "product", "source", "lot-b")}`)).toMatchObject({ onHandQuantity: 2, reservedQuantity: 0, availableQuantity: 2 });
    expect(state.db.row(`inventoryBalances/${balanceDocumentId("org", "product", "source", "lot-a")}`).version).toBe(0);
    expect(state.db.row("stockReservations/transfer__product")).toMatchObject({ remainingQuantity: 0, remainingLotAllocations: [], releasedQuantity: 2 });
  });

  it("requires review instead of guessing a partially consumed legacy lot remainder", async () => {
    seedLotRemainder(false);
    await expect(cancellation()).rejects.toMatchObject({ details: { code: "TRANSFER_STOCK_REVIEW_REQUIRED" } });
    expect(state.db.row(`inventoryBalances/${balanceDocumentId("org", "product", "source", "lot-b")}`).reservedQuantity).toBe(2);
    expect(state.db.row("transfers/transfer").status).toBe("partially_dispatched");
  });

  it("rejects a stale cancellation before releasing stock", async () => {
    seedLotRemainder();
    await expect(cancellation(0)).rejects.toMatchObject({ code: "aborted" });
    expect(state.db.row(`inventoryBalances/${balanceDocumentId("org", "product", "source", "lot-b")}`).reservedQuantity).toBe(2);
    expect(state.db.all("transferEvents")).toHaveLength(0);
  });

  it("accumulates exact lot ownership over multiple reservation rounds", async () => {
    seedLotRemainder();
    state.db.seed("transfers/transfer", { ...state.db.row("transfers/transfer"), status: "approved", totalDispatchedQuantity: 0, totalReservedQuantity: 0 });
    state.db.seed("transferItems/product", { ...state.db.row("transferItems/product"), reservedQuantity: 0, dispatchedQuantity: 0 });
    state.db.rows.delete("stockReservations/transfer__product");
    for (const lot of ["lot-a", "lot-b"]) state.db.seed(`inventoryBalances/${balanceDocumentId("org", "product", "source", lot)}`, { organizationId: "org", productId: "product", locationId: "source", onHandQuantity: 2, reservedQuantity: 0, availableQuantity: 2 });
    for (const lotId of ["lot-a", "lot-b"]) await reserveTransferStockService(state.actor, "transfer", [{ transferItemId: "product", productId: "product", quantity: 2, serialItemIds: [], lotAllocations: [{ lotId, quantity: 2 }] }], crypto.randomUUID(), "fixture");
    expect(state.db.row("stockReservations/transfer__product")).toMatchObject({ quantity: 4, remainingQuantity: 4, remainingLotAllocations: [{ lotId: "lot-a", quantity: 2 }, { lotId: "lot-b", quantity: 2 }] });
    await releaseTransferReservationService(state.actor, "transfer", undefined, crypto.randomUUID(), "fixture", 1);
    for (const lot of ["lot-a", "lot-b"]) expect(state.db.row(`inventoryBalances/${balanceDocumentId("org", "product", "source", lot)}`).reservedQuantity).toBe(0);
  });

  it("does not oversubscribe stock when the available projection is stale", async () => {
    seedLotRemainder();
    state.db.seed("transfers/transfer", { ...state.db.row("transfers/transfer"), status: "approved", totalDispatchedQuantity: 0, totalReservedQuantity: 0 });
    state.db.seed("transferItems/product", { ...state.db.row("transferItems/product"), reservedQuantity: 0, dispatchedQuantity: 0 });
    state.db.rows.delete("stockReservations/transfer__product");
    const source = `inventoryBalances/${balanceDocumentId("org", "product", "source", "lot-a")}`;
    state.db.seed(source, { organizationId: "org", productId: "product", locationId: "source", onHandQuantity: 2, reservedQuantity: 0, availableQuantity: 100 });
    await expect(reserveTransferStockService(state.actor, "transfer", [{ transferItemId: "product", productId: "product", quantity: 3, serialItemIds: [], lotAllocations: [{ lotId: "lot-a", quantity: 3 }] }], crypto.randomUUID(), "fixture")).rejects.toMatchObject({ code: "failed-precondition" });
    expect(state.db.row(source).reservedQuantity).toBe(0);
  });

  it("releases draft-reduction and pre-approval cancellation demand exactly once", async () => {
    state.db.seed("warehouses/warehouse", { organizationId: "org", status: "active" });
    state.db.seed("branches/branch", { organizationId: "org", status: "active" });
    state.db.seed("inventoryLocations/source", { organizationId: "org", status: "active", warehouseId: "warehouse" });
    state.db.seed("inventoryLocations/destination", { organizationId: "org", status: "active", branchId: "branch" });
    state.db.seed("transfers/transfer", { organizationId: "org", createdBy: "manager", originWarehouseId: "warehouse", destinationBranchId: "branch", version: 0, status: "draft", sourceType: "branch_request", sourceRequestId: "request", totalPlannedQuantity: 10, totalApprovedQuantity: 0 });
    state.db.seed("transferItems/product", { organizationId: "org", transferId: "transfer", productId: "product", plannedQuantity: 10, approvedQuantity: 0, sourceRequestItemId: "request-item", requestAllocatedQuantity: 10 });
    state.db.seed("branchRequests/request", { organizationId: "org", branchId: "branch", totalApprovedQuantity: 20, totalFulfilledQuantity: 0 });
    state.db.seed("branchRequestItems/request-item", { organizationId: "org", requestId: "request", productId: "product", approvedQuantity: 20, fulfilledQuantity: 0, transferAllocatedQuantity: 10, outstandingQuantity: 20 });
    const data = { transferId: "transfer", expectedVersion: 0, originWarehouseId: "warehouse", originLocationId: "source", destinationBranchId: "branch", destinationLocationId: "destination", purpose: "Reduce requested demand", priority: "normal", items: [{ productId: "product", quantity: 6 }], idempotencyKey: crypto.randomUUID() };
    await updateTransferDraft.run({ data } as Parameters<typeof updateTransferDraft.run>[0]);
    expect(state.db.row("branchRequestItems/request-item").transferAllocatedQuantity).toBe(6);
    state.db.failNextCommitFor = "branchRequestItems/";
    await expect(cancellation(0)).rejects.toThrow("Injected transaction-finalization");
    expect(state.db.row("transferItems/product").requestAllocatedQuantity).toBe(6);
    expect(state.db.row("transfers/transfer").status).toBe("draft");
    await cancellation(0);
    expect(state.db.row("branchRequestItems/request-item")).toMatchObject({ transferAllocatedQuantity: 0, fulfilledQuantity: 0, outstandingQuantity: 20 });
    expect(state.db.row("transferItems/product").requestAllocatedQuantity).toBe(0);
  });

  it("rolls back reservation and demand release together, then survives a transaction retry", async () => {
    seedLotRemainder();
    state.db.seed("transfers/transfer", { ...state.db.row("transfers/transfer"), sourceType: "branch_request", sourceRequestId: "request" });
    state.db.seed("transferItems/product", { ...state.db.row("transferItems/product"), sourceRequestItemId: "request-item", requestAllocatedQuantity: 4 });
    state.db.seed("branchRequests/request", { organizationId: "org", branchId: "branch", totalApprovedQuantity: 4, totalFulfilledQuantity: 0 });
    state.db.seed("branchRequestItems/request-item", { organizationId: "org", requestId: "request", productId: "product", approvedQuantity: 4, fulfilledQuantity: 0, transferAllocatedQuantity: 4 });
    state.db.failNextCommitFor = "branchRequestItems/";
    await expect(cancellation()).rejects.toThrow("Injected transaction-finalization");
    const source = `inventoryBalances/${balanceDocumentId("org", "product", "source", "lot-b")}`;
    expect(state.db.row(source)).toMatchObject({ reservedQuantity: 2, version: 0 });
    expect(state.db.row("branchRequestItems/request-item").transferAllocatedQuantity).toBe(4);
    state.db.retryNext = true;
    await cancellation();
    expect(state.db.row(source)).toMatchObject({ reservedQuantity: 0, version: 1 });
    expect(state.db.row("branchRequestItems/request-item").transferAllocatedQuantity).toBe(2);
    expect(state.db.row("transferItems/product").requestAllocatedQuantity).toBe(2);
  });
});

describe("legacy dispatch includes all selected packages", () => {
  it.each([1, 30, 31, 100])("posts and projects all %i packages, then replays without moving more stock", async count => {
    const packageIds = Array.from({ length: count }, (_, index) => `package-${index}`);
    state.db.seed("transfers/transfer", { organizationId: "org", originWarehouseId: "warehouse", originLocationId: "source", transitLocationId: "transit", destinationBranchId: "branch", version: 1, status: "ready_for_dispatch", totalApprovedQuantity: count, totalReservedQuantity: count });
    state.db.seed("transferDispatches/dispatch", { organizationId: "org", transferId: "transfer", dispatchNumber: "DSP-1", status: "draft", packageIds, quantity: count });
    state.db.seed("transferItems/item", { organizationId: "org", transferId: "transfer", productId: "product", trackingType: "quantity", approvedQuantity: count, dispatchedQuantity: 0 });
    state.db.seed("stockReservations/transfer__item", { organizationId: "org", transferId: "transfer", productId: "product", sourceLocationId: "source", remainingQuantity: count, consumedQuantity: 0 });
    state.db.seed("fixtureStock/source", { quantity: count });
    state.db.seed("fixtureStock/transit", { quantity: 0 });
    for (const id of packageIds) {
      state.db.seed(`transferPackages/${id}`, { organizationId: "org", transferId: "transfer", status: "sealed", quantity: 1 });
      state.db.seed(`transferPackageItems/${id}`, { organizationId: "org", transferId: "transfer", packageId: id, transferItemId: "item", productId: "product", quantity: 1, serialItemIds: [], lotAllocations: [] });
    }
    const data = { transferId: "transfer", dispatchId: "dispatch", packageIds, expectedVersion: 1, driverName: "Fixture Driver", idempotencyKey: crypto.randomUUID() };
    const invoke = () => confirmTransferDispatch.run({ data } as Parameters<typeof confirmTransferDispatch.run>[0]);
    await expect(invoke()).resolves.toMatchObject({ confirmed: true });
    expect(state.post).toHaveBeenCalledTimes(1);
    expect(state.post.mock.calls[0]![1]).toMatchObject({ quantity: count, sourceLocationId: "source", destinationLocationId: "transit", transferContext: { transferId: "transfer", consumeReservedQuantity: count } });
    expect(state.db.row("fixtureStock/source").quantity).toBe(0);
    expect(state.db.row("fixtureStock/transit").quantity).toBe(count);
    expect(state.db.row("transfers/transfer")).toMatchObject({ status: "dispatched", totalDispatchedQuantity: count, totalReservedQuantity: 0 });
    expect(state.db.row("stockReservations/transfer__item")).toMatchObject({ status: "consumed", remainingQuantity: 0, consumedQuantity: count });
    expect(state.db.all("transferPackages").every(row => row.status === "dispatched")).toBe(true);
    await expect(invoke()).resolves.toMatchObject({ confirmed: false });
    expect(state.post).toHaveBeenCalledTimes(1);
  });

  it("does not cancel request demand twice when a partial transfer is cancelled again with a fresh key", async () => {
    state.db.seed("transfers/transfer", { organizationId: "org", originWarehouseId: "warehouse", destinationBranchId: "branch", sourceType: "branch_request", sourceRequestId: "request", status: "partially_dispatched", version: 1, totalApprovedQuantity: 20, totalDispatchedQuantity: 12, totalReservedQuantity: 0 });
    state.db.seed("transferItems/item", { organizationId: "org", transferId: "transfer", productId: "product", requestAllocatedQuantity: 20, approvedQuantity: 20, dispatchedQuantity: 12, cancelledQuantity: 0, sourceRequestItemId: "request-item" });
    state.db.seed("branchRequests/request", { organizationId: "org", branchId: "branch", totalApprovedQuantity: 20, totalFulfilledQuantity: 0 });
    state.db.seed("branchRequestItems/request-item", { organizationId: "org", requestId: "request", productId: "product", approvedQuantity: 20, fulfilledQuantity: 0, outstandingQuantity: 20, transferAllocatedQuantity: 20 });
    const cancel = () => cancelTransfer.run({ data: { transferId: "transfer", expectedVersion: 1, reason: "Undispatched remainder no longer needed", idempotencyKey: crypto.randomUUID() } } as Parameters<typeof cancelTransfer.run>[0]);
    await cancel();
    expect(state.db.row("branchRequestItems/request-item").transferAllocatedQuantity).toBe(12);
    // Another transfer now owns the freed eight units of request demand.
    state.db.seed("branchRequestItems/request-item", { ...state.db.row("branchRequestItems/request-item"), transferAllocatedQuantity: 20 });
    await cancel();
    expect(state.db.row("branchRequestItems/request-item")).toMatchObject({ transferAllocatedQuantity: 20, approvedQuantity: 20, fulfilledQuantity: 0, outstandingQuantity: 20 });
    expect(state.db.row("transferItems/item")).toMatchObject({ cancelledQuantity: 8, outstandingQuantity: 12 });
    expect(state.post).not.toHaveBeenCalled();
  });
});

function combinedAccess(base: RoleId = "operations_administrator", global: Permission[] = ["transfers.read.all"], direct: RoleId = "warehouse_manager") {
  const role: StoredRole = { id: "global-reader", organizationId: "org", name: "Global reader", baseRoleId: base, permissionIds: global, status: "active" };
  state.db.seed("roles/global-reader", { ...role });
  state.actor = accessProfileFromRecord("manager", { organizationId: "org", status: "active", branchIds: ["other-branch"], warehouseIds: ["other-warehouse"], authorizationVersion: 1, ...buildRoleAssignment([direct], [role]) });
}
const invokeLegacy = (name: keyof typeof legacy, data: object) => (legacy[name] as { run: (request: never) => Promise<unknown> }).run({ data } as never);
function approvalInput() {
  seedDispatch();
  state.db.seed("transfers/transfer", { ...state.db.row("transfers/transfer"), status: "under_review", totalPlannedQuantity: 4, createdBy: "manager" });
  for (const product of ["product", "other"]) state.db.seed(`transferItems/${product}`, { ...state.db.row(`transferItems/${product}`), plannedQuantity: 2 });
  return { transferId: "transfer", expectedVersion: 1, reason: "Source stock reviewed", idempotencyKey: crypto.randomUUID() };
}

describe("approved transfer action scope and retry security", () => {
  const sourceActions: Array<[keyof typeof legacy, (base: { transferId: string; expectedVersion: number; idempotencyKey: string }) => object]> = [
    ...(["submitTransfer", "startTransferReview", "requestTransferChanges", "approveTransfer", "rejectTransfer", "startTransferPicking", "releaseTransferReservation", "cancelTransfer", "closeTransfer"] as const).map(name => [name, (base: object) => ({ ...base, reason: "Verified request" })] as [keyof typeof legacy, (base: { transferId: string; expectedVersion: number; idempotencyKey: string }) => object]),
    ["updateTransferDraft", base => ({ ...base, originWarehouseId: "warehouse", originLocationId: "source", destinationBranchId: "branch", destinationLocationId: "destination", purpose: "Transfer source review", priority: "normal", items: [{ productId: "product", quantity: 1 }] })],
    ["reserveTransferStock", base => ({ ...base, lines: [{ transferItemId: "product", productId: "product", quantity: 1 }] })],
    ["recordPickedItems", base => ({ ...base, lines: [{ transferItemId: "product", quantity: 1 }] })],
    ["createTransferPackage", base => ({ ...base, lines: [{ transferItemId: "product", quantity: 1 }] })],
    ["verifyPickedItems", base => ({ ...base, pickId: "pick", accepted: true })],
    ["sealTransferPackage", base => ({ ...base, packageId: "package-product" })],
    ["verifyPacking", base => ({ ...base, packageId: "package-product" })],
    ["createTransferDispatch", base => ({ ...base, packageIds: ["package-product"], driverName: "Driver" })],
    ["confirmTransferDispatch", base => ({ ...base, dispatchId: "dispatch", packageIds: ["package-product"], driverName: "Driver" })],
    ["assignTransferDiscrepancy", base => ({ ...base, discrepancyId: "discrepancy", resolutionType: "no_variance_found", note: "Reviewed evidence" })],
    ["resolveTransferDiscrepancy", base => ({ ...base, discrepancyId: "discrepancy", resolutionType: "no_variance_found", note: "Reviewed evidence" })],
    ["createTransferCost", base => ({ ...base, category: "transportation", description: "Transport cost", estimatedAmountMinor: 100 })],
    ["submitTransferCost", base => ({ ...base, costId: "cost" })],
    ["approveTransferCost", base => ({ ...base, costId: "cost", amountMinor: 100 })],
    ["recordActualTransferCost", base => ({ ...base, costId: "cost", amountMinor: 100 })],
    ["reconcileTransferCosts", base => ({ ...base, costId: "cost" })],
  ];

  it.each(sourceActions)("does not promote global reading into remote %s authority", async (name, payload) => {
    seedDispatch();
    combinedAccess();
    await expect(invokeLegacy(name, payload({ transferId: "transfer", expectedVersion: 1, idempotencyKey: crypto.randomUUID() }))).rejects.toMatchObject({ code: "permission-denied" });
    expect(state.db.all("idempotencyKeys")).toHaveLength(0);
    expect(state.post).not.toHaveBeenCalled();
  });

  it.each(["finance_officer", "auditor"] as const)("does not promote a read-only %s base into remote source authority", async base => {
    const input = approvalInput();
    combinedAccess(base);
    await expect(legacy.approveTransfer.run({ data: input } as never)).rejects.toMatchObject({ code: "permission-denied" });
    expect(state.db.row("transfers/transfer").status).toBe("under_review");
  });

  it.each(["createTransferReceipt", "confirmTransferReceipt"] as const)("requires destination authority for %s", async name => {
    await dispatch(seedDispatch(["product"]));
    const input = seedReceipt([receiptLine()]);
    combinedAccess("operations_administrator", ["transfers.read.all"], "branch_manager");
    await expect(invokeLegacy(name, input)).rejects.toMatchObject({ code: "permission-denied" });
    expect(state.db.all("inventoryTransactions")).toHaveLength(1);
  });

  it("allows a destination report but denies source approval/release to that location", async () => {
    await dispatch(seedDispatch(["product"]));
    combinedAccess("operations_administrator", ["transfers.read.all", "transfers.approve", "transfers.release_reservation"], "branch_manager");
    // Explicit global action grants are absent: only local branch capabilities.
    const role = state.db.row("roles/global-reader");
    state.db.seed("roles/global-reader", { ...role, permissionIds: ["transfers.read.all"] });
    state.actor = { ...state.actor, branchIds: ["branch"] };
    for (const name of ["approveTransfer", "releaseTransferReservation"] as const)
      await expect(invokeLegacy(name, { transferId: "transfer", expectedVersion: 1, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "permission-denied" });
    await expect(invokeLegacy("reportTransferDiscrepancy", { transferId: "transfer", dispatchId: "dispatch", expectedVersion: 1, type: "missing_quantity", description: "One unit missing", lines: [{ transferItemId: "product", quantity: 1 }], idempotencyKey: crypto.randomUUID(), operatingContext: { type: "branch", id: "branch" } })).resolves.toMatchObject({ created: true });
  });

  it("preserves assigned manager self-approval and replays canonical parsed payloads without another write", async () => {
    const input = approvalInput();
    await expect(invokeLegacy("approveTransfer", input)).resolves.toMatchObject({ changed: true });
    const count = state.db.all("transferApprovals").length;
    await expect(invokeLegacy("approveTransfer", { idempotencyKey: input.idempotencyKey, reason: `  ${input.reason}  `, expectedVersion: 1, transferId: "transfer" })).resolves.toMatchObject({ changed: false, repeated: true });
    expect(state.db.all("transferApprovals")).toHaveLength(count);
  });

  it("binds the retry key to actor, action, entity and payload", async () => {
    const input = approvalInput();
    await invokeLegacy("approveTransfer", input);
    for (const altered of [{ ...input, reason: "Changed instructions" }, { ...input, transferId: "other-transfer" }]) {
      state.db.seed("transfers/other-transfer", { ...state.db.row("transfers/transfer") });
      await expect(invokeLegacy("approveTransfer", altered)).rejects.toMatchObject({ details: { code: "TRANSFER_RETRY_MISMATCH" } });
    }
    await expect(invokeLegacy("cancelTransfer", input)).rejects.toMatchObject({ details: { code: "TRANSFER_RETRY_MISMATCH" } });
    state.actor = { ...state.actor, userId: "other-manager" };
    await expect(invokeLegacy("approveTransfer", input)).rejects.toMatchObject({ details: { code: "TRANSFER_RETRY_MISMATCH" } });
    expect(state.db.all("transferApprovals")).toHaveLength(1);
  });

  it("rechecks reassignment and removed permissions before returning cached confirmation references", async () => {
    const input = seedDispatch(["product"]);
    await dispatch(input);
    combinedAccess(); // Global reader still sees the transfer, but no longer owns its source.
    await expect(dispatch(input)).rejects.toMatchObject({ code: "permission-denied" });
    state.actor = { ...state.actor, warehouseIds: ["warehouse"], directRoleIds: [], effectivePermissions: ["transfers.read.all"] };
    await expect(dispatch(input)).rejects.toMatchObject({ code: "permission-denied" });
    expect(state.db.all("inventoryTransactions")).toHaveLength(1);
  });

  it("requires reading authority as well as action authority on replay", async () => {
    const input = approvalInput();
    await invokeLegacy("approveTransfer", input);
    state.actor = { ...state.actor, directRoleIds: [], effectivePermissions: ["transfers.approve"] };
    await expect(invokeLegacy("approveTransfer", input)).rejects.toMatchObject({ code: "permission-denied" });
    expect(state.db.all("transferApprovals")).toHaveLength(1);
  });

  it("requires a working location for multiple scoped assignments despite a broad read-only role", async () => {
    const input = approvalInput();
    combinedAccess();
    state.actor = { ...state.actor, warehouseIds: ["warehouse", "second-warehouse"] };
    await expect(invokeLegacy("approveTransfer", input)).rejects.toMatchObject({ details: { code: "OPERATING_CONTEXT_REQUIRED" } });
    expect(state.db.all("transferApprovals")).toHaveLength(0);
  });

  it("rechecks the selected working location before replay even when both locations are assigned", async () => {
    const input = approvalInput();
    combinedAccess();
    state.actor = { ...state.actor, warehouseIds: ["warehouse", "second-warehouse"] };
    await expect(invokeLegacy("approveTransfer", { ...input, operatingContext: { type: "warehouse", id: "warehouse" } })).resolves.toMatchObject({ changed: true });
    await expect(invokeLegacy("approveTransfer", { ...input, operatingContext: { type: "warehouse", id: "second-warehouse" } })).rejects.toMatchObject({ code: "permission-denied" });
    expect(state.db.all("transferApprovals")).toHaveLength(1);
  });

  it("revalidates child ownership before returning a cached dispatch result", async () => {
    const input = seedDispatch(["product"]);
    await dispatch(input);
    state.db.seed("transferDispatches/dispatch", { ...state.db.row("transferDispatches/dispatch"), transferId: "another-transfer" });
    await expect(dispatch(input)).rejects.toMatchObject({ code: "not-found" });
    expect(state.db.all("inventoryTransactions")).toHaveLength(1);
  });

  it("rechecks destination reassignment before replaying a completed receipt", async () => {
    await dispatch(seedDispatch(["product"]));
    const input = seedReceipt([receiptLine()]);
    await receive(input);
    combinedAccess("operations_administrator", ["transfers.read.all"], "branch_manager");
    state.actor = { ...state.actor, userId: "receiver" };
    await expect(receive(input)).rejects.toMatchObject({ code: "permission-denied" });
    expect(state.db.all("inventoryTransactions")).toHaveLength(2);
  });

  it("does not replay a result across organizations", async () => {
    const input = approvalInput();
    await invokeLegacy("approveTransfer", input);
    state.actor = { ...state.actor, organizationId: "foreign-org" };
    await expect(invokeLegacy("approveTransfer", input)).rejects.toMatchObject({ code: "not-found" });
    expect(state.db.all("transferApprovals")).toHaveLength(1);
  });

  it.each(["verifyPacking", "assignTransferDiscrepancy"] as const)("keeps %s metadata idempotent under identical concurrent commands", async name => {
    seedDispatch(["product"]);
    state.db.seed("transferDiscrepancies/discrepancy", { organizationId: "org", transferId: "transfer", status: "open" });
    const input = { transferId: "transfer", expectedVersion: 1, idempotencyKey: crypto.randomUUID(), ...(name === "verifyPacking" ? { packageId: "package-product" } : { discrepancyId: "discrepancy", resolutionType: "no_variance_found", note: "Source evidence review" }) };
    const results = await Promise.all([invokeLegacy(name, input), invokeLegacy(name, input)]) as Array<{ verified?: boolean; assigned?: boolean }>;
    expect(results.filter(result => result.verified || result.assigned)).toHaveLength(1);
    await expect(invokeLegacy(name, input)).resolves.toMatchObject({ repeated: true });
    expect(state.db.all("idempotencyKeys")).toHaveLength(2);
    expect(state.post).not.toHaveBeenCalled();
  });

  it("binds creation retries and rechecks the original created transfer's current source", async () => {
    state.actor = { userId: "admin", organizationId: "org", roleId: "system_administrator", roleIds: ["system_administrator"], directRoleIds: ["system_administrator"], branchIds: [], warehouseIds: [], authorizationVersion: 1 };
    for (const [path, row] of [
      ["warehouses/warehouse", { code: "WH", name: "Source" }], ["branches/branch", { code: "BR", name: "Destination" }],
      ["inventoryLocations/source", { warehouseId: "warehouse", type: "warehouse" }], ["inventoryLocations/destination", { branchId: "branch", type: "branch" }],
    ] as const) state.db.seed(path, { organizationId: "org", status: "active", ...row });
    state.db.seed("products/product", { organizationId: "org", active: true, name: "Panel", sku: "PV", trackingType: "quantity", unitOfMeasure: "unit" });
    const input = { originWarehouseId: "warehouse", originLocationId: "source", destinationBranchId: "branch", destinationLocationId: "destination", purpose: "Supply destination stock", directTransferReason: "Source allocation review", priority: "normal", items: [{ productId: "product", quantity: 2 }], idempotencyKey: crypto.randomUUID() };
    const created = await invokeLegacy("createAdminTransfer", input) as { transferId: string };
    await expect(invokeLegacy("createAdminTransfer", input)).resolves.toMatchObject({ transferId: created.transferId, created: false, repeated: true });
    await expect(invokeLegacy("createAdminTransfer", { ...input, purpose: "Altered stock instructions" })).rejects.toMatchObject({ details: { code: "TRANSFER_RETRY_MISMATCH" } });
    state.actor = { ...state.actor, roleId: "warehouse_manager", roleIds: ["warehouse_manager"], directRoleIds: [], effectivePermissions: ["transfers.create.direct", "transfers.read.all"], warehouseIds: ["warehouse"] };
    state.db.seed(`transfers/${created.transferId}`, { ...state.db.row(`transfers/${created.transferId}`), originWarehouseId: "other-warehouse" });
    await expect(invokeLegacy("createAdminTransfer", input)).rejects.toMatchObject({ code: "permission-denied" });
    expect(state.db.all("transfers")).toHaveLength(1);
  });

  it("preserves explicit finance cost approval without granting source stock actions", async () => {
    seedDispatch(["product"]);
    state.db.seed("transferCosts/cost", { organizationId: "org", transferId: "transfer", status: "submitted", createdBy: "warehouse-user" });
    state.actor = { userId: "finance", organizationId: "org", roleId: "finance_officer", roleIds: ["finance_officer"], directRoleIds: ["finance_officer"], branchIds: [], warehouseIds: [], authorizationVersion: 1 };
    await expect(invokeLegacy("approveTransferCost", { transferId: "transfer", costId: "cost", amountMinor: 100, idempotencyKey: crypto.randomUUID() })).resolves.toMatchObject({ changed: true });
    await expect(dispatch({ ...seedDispatch(["product"]), idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("honors only the exact globally granted operations action and its current role document", async () => {
    const input = seedDispatch(["product"]);
    combinedAccess("operations_administrator", ["transfers.read.all", "transfers.dispatch"]);
    await expect(dispatch(input)).resolves.toMatchObject({ confirmed: true });
    await expect(cancellation()).rejects.toMatchObject({ code: "permission-denied" });
    state.db.seed("roles/global-reader", { ...state.db.row("roles/global-reader"), permissionIds: ["transfers.read.all"] });
    await expect(dispatch(input)).rejects.toMatchObject({ code: "permission-denied" });
    expect(state.db.all("inventoryTransactions")).toHaveLength(1);
  });

  it("retains explicitly assigned organization administrator authority", async () => {
    const input = approvalInput();
    state.actor = { userId: "admin", organizationId: "org", roleId: "operations_administrator", roleIds: ["operations_administrator"], directRoleIds: ["operations_administrator"], branchIds: [], warehouseIds: [], authorizationVersion: 1 };
    await expect(invokeLegacy("approveTransfer", input)).resolves.toMatchObject({ changed: true });
  });

  it("requires review for an unbound historical key without rewriting it", async () => {
    const input = approvalInput();
    state.db.seed(`idempotencyKeys/org_approveTransfer_${input.idempotencyKey}`, { organizationId: "org", action: "approveTransfer", createdBy: "manager", entityId: "transfer", status: "completed" });
    await expect(invokeLegacy("approveTransfer", input)).rejects.toMatchObject({ details: { code: "TRANSFER_RETRY_REVIEW_REQUIRED" } });
    expect(state.db.all("transferApprovals")).toHaveLength(0);
    expect(state.db.rows.has(transferCommandRef("org", input.idempotencyKey).path)).toBe(false);
  });

  it("retains an unfinished command binding after failure and permits only the original actor/key/payload to resume", async () => {
    const input = seedDispatch();
    state.failAfterProduct = "other";
    await expect(dispatch(input)).rejects.toThrow("Injected");
    state.actor = { ...state.actor, userId: "other-manager" };
    await expect(dispatch(input)).rejects.toMatchObject({ details: { code: "TRANSFER_RETRY_MISMATCH" } });
    state.actor = { ...state.actor, userId: "manager" };
    await expect(dispatch(input)).resolves.toMatchObject({ confirmed: true });
    expect(state.db.all("inventoryTransactions")).toHaveLength(2);
  });

  it("replays completed cancellation after authorization without releasing stock again", async () => {
    seedDispatch(["product"]);
    const input = { transferId: "transfer", expectedVersion: 1, reason: "Cancel before departure", idempotencyKey: crypto.randomUUID() };
    await expect(invokeLegacy("cancelTransfer", input)).resolves.toMatchObject({ cancelled: true });
    const events = state.db.all("transferEvents").length;
    await expect(invokeLegacy("cancelTransfer", input)).resolves.toMatchObject({ cancelled: false, repeated: true });
    expect(state.db.all("transferEvents")).toHaveLength(events);
    expect(state.db.row(`inventoryBalances/${balanceDocumentId("org", "product", "source")}`).reservedQuantity).toBe(0);
  });
});

describe("reviewer routing and committed-command regressions", () => {
  function draft() {
    const active = { organizationId: "org", status: "active" };
    state.db.seed("warehouses/warehouse", active);
    state.db.seed("branches/branch", active);
    state.db.seed("inventoryLocations/source", { ...active, warehouseId: "warehouse" });
    state.db.seed("inventoryLocations/destination", { ...active, branchId: "branch" });
    state.db.seed("transfers/transfer", { organizationId: "org", createdBy: "manager", originWarehouseId: "warehouse", originLocationId: "source", destinationBranchId: "branch", destinationLocationId: "destination", sourceType: "admin_allocation", status: "draft", version: 0, totalPlannedQuantity: 2, totalApprovedQuantity: 0 });
    state.db.seed("transferItems/product", { organizationId: "org", transferId: "transfer", productId: "product", plannedQuantity: 2, approvedQuantity: 0 });
    return { transferId: "transfer", expectedVersion: 0, originWarehouseId: "warehouse", originLocationId: "source", destinationBranchId: "branch", destinationLocationId: "destination", purpose: "Reviewed routing update", priority: "normal", items: [{ productId: "product", quantity: 2 }], idempotencyKey: crypto.randomUUID() };
  }

  it.each(["source-other-warehouse", "destination-other-branch", "source-foreign-org", "destination-inactive"])("rejects substituted %s while retaining the original unit ID", async scenario => {
    const input = draft();
    const source = scenario.startsWith("source");
    state.db.seed("inventoryLocations/substituted", { organizationId: scenario.includes("foreign") ? "foreign" : "org", status: scenario.includes("inactive") ? "inactive" : "active", ...(source ? { warehouseId: "other-warehouse" } : { branchId: "other-branch" }) });
    await expect(invokeLegacy("updateTransferDraft", { ...input, [source ? "originLocationId" : "destinationLocationId"]: "substituted" })).rejects.toMatchObject({ code: "failed-precondition" });
    expect(state.db.row("transfers/transfer")).toMatchObject({ originWarehouseId: "warehouse", originLocationId: "source", destinationBranchId: "branch", destinationLocationId: "destination" });
    expect(state.db.all("transferEvents")).toHaveLength(0);
  });

  it("permits an active bin change within the original source and destination units", async () => {
    const input = draft();
    state.db.seed("inventoryLocations/other-bin", { organizationId: "org", status: "active", warehouseId: "warehouse" });
    await expect(invokeLegacy("updateTransferDraft", { ...input, originLocationId: "other-bin" })).resolves.toMatchObject({ updated: true });
    expect(state.db.row("transfers/transfer").originLocationId).toBe("other-bin");
  });

  it("requires cancel/recreate for a draft unit change even when both sources are assigned", async () => {
    const input = draft();
    state.actor = { ...state.actor, warehouseIds: ["warehouse", "other-warehouse"] };
    await expect(invokeLegacy("updateTransferDraft", { ...input, operatingContext: { type: "warehouse", id: "warehouse" }, originWarehouseId: "other-warehouse" })).rejects.toMatchObject({ code: "failed-precondition" });
  });

  it.each(["cancelTransfer", "reserveTransferStock", "releaseTransferReservation"] as const)("recovers committed %s after result-cache failure, with current authorization and exact binding", async action => {
    seedDispatch(["product"]);
    if (action === "reserveTransferStock") {
      state.db.seed("transfers/transfer", { ...state.db.row("transfers/transfer"), status: "approved", totalReservedQuantity: 0 });
      state.db.seed("transferItems/product", { ...state.db.row("transferItems/product"), reservedQuantity: 0 });
      state.db.rows.delete("stockReservations/transfer__product");
      state.db.seed(`inventoryBalances/${balanceDocumentId("org", "product", "source")}`, { organizationId: "org", productId: "product", locationId: "source", onHandQuantity: 2, reservedQuantity: 0, availableQuantity: 2 });
    }
    const input = { transferId: "transfer", expectedVersion: 1, reason: "Reviewed original command", idempotencyKey: crypto.randomUUID() };
    state.db.failNextCommandCompletion = true;
    await expect(invokeLegacy(action, input)).rejects.toThrow("command-cache completion failure");
    expect(state.db.row(transferCommandRef("org", input.idempotencyKey).path).status).toBe("pending");
    const events = state.db.all("transferEvents").length;
    const outbox = state.db.all("integrationOutbox").length;
    const balances = JSON.stringify(state.db.all("inventoryBalances"));
    const actor = state.actor;
    state.actor = { ...actor, warehouseIds: [] };
    await expect(invokeLegacy(action, input)).rejects.toMatchObject({ code: "permission-denied" });
    state.actor = { ...actor, effectivePermissions: ["transfers.read.assigned_warehouse"] };
    await expect(invokeLegacy(action, input)).rejects.toMatchObject({ code: "permission-denied" });
    state.actor = { ...actor, userId: "another-manager" };
    await expect(invokeLegacy(action, input)).rejects.toMatchObject({ details: { code: "TRANSFER_RETRY_MISMATCH" } });
    state.actor = actor;
    await expect(invokeLegacy(action, { ...input, reason: "Altered command payload" })).rejects.toMatchObject({ details: { code: "TRANSFER_RETRY_MISMATCH" } });
    // A later workflow version must not prevent an authorized exact replay.
    state.db.seed("transfers/transfer", { ...state.db.row("transfers/transfer"), version: 2 });
    await expect(invokeLegacy(action, input)).resolves.toMatchObject({ repeated: true, [action === "cancelTransfer" ? "cancelled" : action === "reserveTransferStock" ? "reserved" : "released"]: false, ...(action === "cancelTransfer" ? { remainingCancelled: false } : { quantity: 2 }) });
    expect(state.db.all("transferEvents")).toHaveLength(events);
    expect(state.db.all("integrationOutbox")).toHaveLength(outbox);
    expect(JSON.stringify(state.db.all("inventoryBalances"))).toBe(balances);
    expect(state.db.row(transferCommandRef("org", input.idempotencyKey).path).status).toBe("completed");
  });

  it("records fresh-key zero-delta cancellation without a second real outbox event", async () => {
    seedLotRemainder();
    await expect(cancellation()).resolves.toMatchObject({ remainingCancelled: true });
    const transfer = JSON.stringify(state.db.row("transfers/transfer"));
    const events = state.db.all("transferEvents").length;
    expect(state.db.all("integrationOutbox")).toHaveLength(1);
    await expect(cancellation()).resolves.toMatchObject({ cancelled: false, remainingCancelled: false });
    expect(JSON.stringify(state.db.row("transfers/transfer"))).toBe(transfer);
    expect(state.db.all("transferEvents")).toHaveLength(events);
    expect(state.db.all("integrationOutbox")).toHaveLength(1);
    expect(state.db.all("idempotencyKeys").filter(row => row.action === "cancelTransfer" && row.status === "completed")).toHaveLength(4);
  });

  it("requires item evidence before recording a zero-delta cancellation", async () => {
    seedLotRemainder();
    await cancellation();
    state.db.rows.delete("transferItems/product");
    await expect(cancellation()).rejects.toMatchObject({ details: { code: "TRANSFER_STOCK_REVIEW_REQUIRED" } });
    expect(state.db.all("integrationOutbox")).toHaveLength(1);
  });

  it("can recover a verified older pending binding without inventing omitted response details", async () => {
    seedDispatch(["product"]);
    const input = { transferId: "transfer", expectedVersion: 1, reason: "Original cancellation", idempotencyKey: crypto.randomUUID() };
    state.db.failNextCommandCompletion = true;
    await expect(invokeLegacy("cancelTransfer", input)).rejects.toThrow("command-cache completion failure");
    const path = `idempotencyKeys/org_cancelTransfer_${input.idempotencyKey}`;
    const older = { ...state.db.row(path) };
    delete older.result;
    state.db.seed(path, older);
    await expect(invokeLegacy("cancelTransfer", input)).resolves.toMatchObject({ repeated: true, cancelled: false, remainingCancelled: false });
    expect(state.db.all("integrationOutbox")).toHaveLength(1);
  });

  it("refuses committed operation evidence belonging to another actor", async () => {
    seedDispatch(["product"]);
    const input = { transferId: "transfer", expectedVersion: 1, reason: "Original cancellation", idempotencyKey: crypto.randomUUID() };
    state.db.failNextCommandCompletion = true;
    await expect(invokeLegacy("cancelTransfer", input)).rejects.toThrow("command-cache completion failure");
    const path = `idempotencyKeys/org_cancelTransfer_${input.idempotencyKey}`;
    state.db.seed(path, { ...state.db.row(path), createdBy: "another-manager" });
    await expect(invokeLegacy("cancelTransfer", input)).rejects.toMatchObject({ details: { code: "TRANSFER_RETRY_REVIEW_REQUIRED" } });
    expect(state.db.row(transferCommandRef("org", input.idempotencyKey).path).status).toBe("pending");
  });
});

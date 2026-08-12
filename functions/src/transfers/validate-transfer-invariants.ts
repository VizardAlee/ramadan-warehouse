import type { DocumentData, DocumentSnapshot, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { db } from "../admin.js";
import { evaluateTransferItemQuantities } from "./quantity-invariants.js";

export type ReconciliationCheckStatus = "pass" | "warning" | "fail";

export interface TransferReconciliationCheck {
  code: string;
  status: ReconciliationCheckStatus;
  message: string;
  expected?: unknown;
  actual?: unknown;
}

export interface TransferReconciliationResult {
  transferId: string;
  transferNumber: string;
  status: "clean" | "warning" | "error";
  checkedAt: string;
  checks: TransferReconciliationCheck[];
}

export interface ReconciliationRecord {
  id: string;
  [field: string]: unknown;
}

export interface TransferInvariantSnapshot {
  transfer: ReconciliationRecord;
  items: ReconciliationRecord[];
  reservations: ReconciliationRecord[];
  picks: ReconciliationRecord[];
  packageItems: ReconciliationRecord[];
  dispatches: ReconciliationRecord[];
  dispatchItems: ReconciliationRecord[];
  receipts: ReconciliationRecord[];
  receiptItems: ReconciliationRecord[];
  discrepancies: ReconciliationRecord[];
  costs: ReconciliationRecord[];
  ledgerEntries: ReconciliationRecord[];
}

const quantity = (record: ReconciliationRecord, field: string) =>
  Number(record[field] ?? 0);
const sum = (records: readonly ReconciliationRecord[], field: string) =>
  records.reduce((total, record) => total + quantity(record, field), 0);

function comparison(
  code: string,
  message: string,
  expected: number,
  actual: number,
  severity: "warning" | "fail" = "fail",
): TransferReconciliationCheck {
  return expected === actual
    ? { code, status: "pass", message, expected, actual }
    : { code, status: severity, message, expected, actual };
}

export function evaluateTransferInvariants(
  snapshot: TransferInvariantSnapshot,
  checkedAt = new Date().toISOString(),
): TransferReconciliationResult {
  const { transfer, items } = snapshot;
  const organizationId = String(transfer.organizationId ?? "");
  const transferId = transfer.id;
  const checks: TransferReconciliationCheck[] = [];
  const itemApproved = sum(items, "approvedQuantity");
  const itemPicked = sum(items, "pickedQuantity");
  const itemPacked = sum(items, "packedQuantity");
  const itemDispatched = sum(items, "dispatchedQuantity");
  const itemReceived = sum(items, "receivedQuantity");
  const itemDamaged = sum(items, "damagedQuantity");
  const itemMissing = sum(items, "missingQuantity");
  const itemReturned = sum(items, "returnedQuantity");
  const itemWrittenOff = sum(items, "writtenOffQuantity");
  const itemCancelled = sum(items, "cancelledQuantity");
  const itemOutstanding = sum(items, "outstandingQuantity");

  checks.push(
    comparison("HEADER_APPROVED_TOTAL", "Approved item quantities match the transfer header.", quantity(transfer, "totalApprovedQuantity"), itemApproved),
    comparison("HEADER_PICKED_TOTAL", "Picked item quantities match the transfer header.", quantity(transfer, "totalPickedQuantity"), itemPicked),
    comparison("HEADER_PACKED_TOTAL", "Packed item quantities match the transfer header.", quantity(transfer, "totalPackedQuantity"), itemPacked),
    comparison("HEADER_DISPATCHED_TOTAL", "Dispatched item quantities match the transfer header.", quantity(transfer, "totalDispatchedQuantity"), itemDispatched),
    comparison("HEADER_RECEIVED_TOTAL", "Received item quantities match the transfer header.", quantity(transfer, "totalReceivedQuantity"), itemReceived),
    comparison("HEADER_DAMAGED_TOTAL", "Damaged item quantities match the transfer header.", quantity(transfer, "totalDamagedQuantity"), itemDamaged),
    comparison("HEADER_MISSING_TOTAL", "Missing item quantities match the transfer header.", quantity(transfer, "totalMissingQuantity"), itemMissing),
    comparison("HEADER_RETURNED_TOTAL", "Returned item quantities match the transfer header.", quantity(transfer, "totalReturnedQuantity"), itemReturned),
    comparison("HEADER_WRITTEN_OFF_TOTAL", "Written-off item quantities match the transfer header.", quantity(transfer, "totalWrittenOffQuantity"), itemWrittenOff),
    comparison("HEADER_CANCELLED_TOTAL", "Cancelled item quantities match the transfer header.", quantity(transfer, "cancelledRemainingQuantity"), itemCancelled),
    comparison("HEADER_OUTSTANDING_TOTAL", "Outstanding item quantities match the transfer header.", quantity(transfer, "totalOutstandingQuantity"), itemOutstanding),
  );

  for (const item of items) {
    const releasedReservation = snapshot.reservations
      .filter((reservation) => reservation.transferItemId === item.id)
      .reduce((total, reservation) => total + quantity(reservation, "releasedQuantity"), 0);
    const evaluation = evaluateTransferItemQuantities({
      approved: quantity(item, "approvedQuantity"),
      reserved: quantity(item, "reservedQuantity"),
      releasedReservation,
      picked: quantity(item, "pickedQuantity"),
      packed: quantity(item, "packedQuantity"),
      dispatched: quantity(item, "dispatchedQuantity"),
      received: quantity(item, "receivedQuantity"),
      damaged: quantity(item, "damagedQuantity"),
      missing: quantity(item, "missingQuantity"),
      returned: quantity(item, "returnedQuantity"),
      writtenOff: quantity(item, "writtenOffQuantity"),
      cancelledUndispatched: quantity(item, "cancelledQuantity"),
      outstanding: quantity(item, "outstandingQuantity"),
    });
    for (const violation of evaluation.violations) {
      checks.push({
        code: `ITEM_${violation}`,
        status: "fail",
        message: `Quantity invariant ${violation} failed for item ${item.id}.`,
      });
    }
    if (!evaluation.violations.length)
      checks.push({ code: "ITEM_QUANTITY_ACCOUNTING", status: "pass", message: `Quantity accounting is valid for item ${item.id}.` });
  }

  const activeReservations = snapshot.reservations.filter((record) =>
    ["active", "partially_consumed"].includes(String(record.status)),
  );
  const deliveredLaterQuantity = snapshot.discrepancies
    .filter(
      (record) =>
        record.status === "resolved" &&
        record.resolutionType === "delivered_later",
    )
    .reduce((total, record) => total + quantity(record, "quantity"), 0);
  const branchReturnedQuantity = snapshot.discrepancies
    .filter(
      (record) =>
        record.status === "resolved" &&
        record.resolutionType === "returned_to_warehouse" &&
        record.type === "delivery_refused",
    )
    .reduce((total, record) => total + quantity(record, "quantity"), 0);
  checks.push(
    comparison("ACTIVE_RESERVATION_TOTAL", "Active reservation remainder matches the header.", quantity(transfer, "totalReservedQuantity"), sum(activeReservations, "remainingQuantity")),
    comparison("PICK_RECORD_TOTAL", "Pick records match picked item totals.", itemPicked, sum(snapshot.picks, "quantity"), "warning"),
    comparison("PACKAGE_CONTENT_TOTAL", "Package contents match packed item totals.", itemPacked, sum(snapshot.packageItems, "quantity")),
    comparison(
      "DISPATCH_CONTENT_TOTAL",
      "Dispatch contents match dispatched item totals.",
      itemDispatched,
      snapshot.dispatchItems.length
        ? sum(snapshot.dispatchItems, "quantity")
        : sum(
            snapshot.dispatches.filter((dispatch) =>
              !["draft", "cancelled"].includes(String(dispatch.status)),
            ),
            "quantity",
          ),
    ),
    comparison(
      "RECEIPT_CONTENT_TOTAL",
      "Receipt contents and resolved late deliveries match received item totals.",
      itemReceived + branchReturnedQuantity,
      sum(snapshot.receiptItems, "receivedQuantity") + deliveredLaterQuantity,
    ),
  );

  const transitExpected = Math.max(
    0,
    itemDispatched - itemReceived - itemDamaged - quantity(transfer, "totalReturnedQuantity") - quantity(transfer, "totalWrittenOffQuantity"),
  );
  const ledgerTransit = snapshot.ledgerEntries.reduce((total, entry) => {
    const locationId = String(entry.locationId ?? "");
    if (locationId !== String(transfer.transitLocationId ?? "")) return total;
    return total + quantity(entry, "quantityDelta");
  }, 0);
  checks.push(comparison("TRANSIT_LEDGER_TOTAL", "Transit ledger quantity matches undisposed dispatched stock.", transitExpected, ledgerTransit));

  const related = [
    ...snapshot.items,
    ...snapshot.reservations,
    ...snapshot.picks,
    ...snapshot.packageItems,
    ...snapshot.dispatches,
    ...snapshot.dispatchItems,
    ...snapshot.receipts,
    ...snapshot.receiptItems,
    ...snapshot.discrepancies,
    ...snapshot.costs,
    ...snapshot.ledgerEntries,
  ];
  const foreign = related.filter(
    (record) =>
      record.organizationId !== organizationId ||
      (record.transferId !== undefined && record.transferId !== transferId),
  );
  checks.push({
    code: "RELATED_RECORD_SCOPE",
    status: foreign.length === 0 ? "pass" : "fail",
    message: "Every related record belongs to the transfer organization and transfer.",
    expected: 0,
    actual: foreign.length,
  });

  if (transfer.status === "closed") {
    const unresolved = snapshot.discrepancies.filter(
      (record) => !["resolved", "closed"].includes(String(record.status)),
    ).length;
    const unreconciledCosts = snapshot.costs.filter(
      (record) => record.status !== "reconciled",
    ).length;
    checks.push(
      comparison("CLOSED_DISCREPANCIES", "Closed transfers have no unresolved discrepancies.", 0, unresolved),
      comparison("CLOSED_COSTS", "Closed transfers have no unreconciled costs.", 0, unreconciledCosts),
      comparison("CLOSED_RESERVATIONS", "Closed transfers have no active reservations.", 0, activeReservations.length),
    );
  }

  const status = checks.some((check) => check.status === "fail")
    ? "error"
    : checks.some((check) => check.status === "warning")
      ? "warning"
      : "clean";
  return {
    transferId,
    transferNumber: String(transfer.transferNumber ?? transferId),
    status,
    checkedAt,
    checks,
  };
}

export async function assertTransferInvariantGate(
  organizationId: string,
  transferId: string,
  stage: string,
): Promise<TransferReconciliationResult> {
  const result = await validateTransferInvariants(organizationId, transferId);
  const failures = result.checks.filter((check) => check.status === "fail");
  if (failures.length) {
    const error = new Error(`TRANSFER_INVARIANT_FAILED:${stage}:${failures.map((check) => check.code).join(",")}`);
    error.name = "TransferInvariantError";
    throw error;
  }
  return result;
}

const record = (snapshot: DocumentSnapshot | QueryDocumentSnapshot): ReconciliationRecord => ({
  id: snapshot.id,
  ...(snapshot.data() as DocumentData | undefined),
});

async function related(collection: string, transferId: string) {
  return db.collection(collection).where("transferId", "==", transferId).limit(500).get();
}

export async function validateTransferInvariants(
  organizationId: string,
  transferId: string,
): Promise<TransferReconciliationResult> {
  const transfer = await db.doc(`transfers/${transferId}`).get();
  if (!transfer.exists || transfer.get("organizationId") !== organizationId)
    throw new Error("TRANSFER_NOT_FOUND");
  const collections = [
    "transferItems",
    "stockReservations",
    "transferPicks",
    "transferPackageItems",
    "transferDispatches",
    "transferDispatchItems",
    "transferReceipts",
    "transferReceiptItems",
    "transferDiscrepancies",
    "transferCosts",
    "inventoryEntries",
  ] as const;
  const results = await Promise.all(collections.map((name) => related(name, transferId)));
  return evaluateTransferInvariants({
    transfer: record(transfer),
    items: results[0]!.docs.map(record),
    reservations: results[1]!.docs.map(record),
    picks: results[2]!.docs.map(record),
    packageItems: results[3]!.docs.map(record),
    dispatches: results[4]!.docs.map(record),
    dispatchItems: results[5]!.docs.map(record),
    receipts: results[6]!.docs.map(record),
    receiptItems: results[7]!.docs.map(record),
    discrepancies: results[8]!.docs.map(record),
    costs: results[9]!.docs.map(record),
    ledgerEntries: results[10]!.docs.map(record),
  });
}

import { HttpsError } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import { pendingStock, type StockTransfer } from "./simple-model.js";
import type {
  ReconciliationRecord,
  TransferReconciliationCheck,
  TransferReconciliationResult,
} from "./validate-transfer-invariants.js";

export function evaluateSimpleTransfer(
  transfer: StockTransfer,
  receipts: ReconciliationRecord[],
  entries: ReconciliationRecord[],
): TransferReconciliationResult {
  const checks: TransferReconciliationCheck[] = [];
  const check = (
    code: string,
    message: string,
    expected: number,
    actual: number,
  ) =>
    checks.push({
      code,
      message,
      expected,
      actual,
      status: expected === actual ? "pass" : "fail",
    });
  const sum = (records: ReconciliationRecord[], field: string) =>
    records.reduce((total, r) => total + Number(r[field] ?? 0), 0);
  for (const line of transfer.items) {
    check(
      "SIMPLE_QUANTITIES",
      `${line.productName}: all quantities are nonnegative whole units within approval.`,
      1,
      Number(
        [
          line.requested,
          line.approved,
          line.received,
          line.damaged,
          line.cancelled,
          line.writtenOff,
          pendingStock(line),
        ].every((n) => Number.isSafeInteger(n) && n >= 0) &&
          line.approved <= line.requested,
      ),
    );
    const evidence = receipts.filter((r) => r.lineId === line.id);
    for (const field of ["received", "damaged", "writtenOff"] as const)
      check(
        "SIMPLE_RECEIPT_EVIDENCE",
        `${line.productName}: ${field} matches immutable receipt evidence.`,
        line[field],
        sum(evidence, field),
      );
    const ledger = entries.filter(
      (e) =>
        e.productId === line.productId &&
        (e.lotId ?? null) === (line.lotId ?? null),
    );
    check(
      "SIMPLE_SOURCE_ISSUE",
      `${line.productName}: source issue matches acknowledged or written-off goods.`,
      -(line.received + line.damaged + line.writtenOff),
      sum(
        ledger.filter((e) => e.locationId === transfer.sourceLocationId),
        "quantityDelta",
      ),
    );
    check(
      "SIMPLE_DESTINATION_RECEIPT",
      `${line.productName}: only good arrivals enter saleable destination stock.`,
      line.received,
      sum(
        ledger.filter((e) => e.locationId === transfer.destinationLocationId),
        "quantityDelta",
      ),
    );
    check(
      "SIMPLE_DAMAGE",
      `${line.productName}: damaged arrivals are separate.`,
      line.damaged,
      sum(
        ledger.filter(
          (e) =>
            e.locationId === `simple_damaged_${transfer.destinationBranchId}`,
        ),
        "quantityDelta",
      ),
    );
    check(
      "SIMPLE_LOSS",
      `${line.productName}: confirmed loss has external inventory evidence.`,
      line.writtenOff,
      sum(
        ledger.filter((e) => e.externalAccount === "inventory_loss"),
        "quantityDelta",
      ),
    );
    if (line.trackingType === "serial")
      check(
        "SIMPLE_SERIAL_HOLD",
        `${line.productName}: each outstanding unit has a distinct reserved serial.`,
        pendingStock(line),
        new Set(line.serialItemIds).size,
      );
  }
  const transactionIds = new Set([
    ...entries.map((e) => String(e.transactionId)),
    ...receipts.map((r) => String(r.transactionId)),
  ]);
  for (const id of transactionIds) {
    const ledger = entries.filter((e) => e.transactionId === id);
    check(
      "SIMPLE_LEDGER_EVIDENCE",
      `${id}: movement has ledger entries.`,
      1,
      Number(ledger.length >= 2),
    );
    check(
      "SIMPLE_QUANTITY_CONSERVATION",
      `${id}: quantities balance.`,
      0,
      sum(ledger, "quantityDelta"),
    );
    check(
      "SIMPLE_VALUE_CONSERVATION",
      `${id}: Naira/kobo values balance exactly.`,
      0,
      sum(ledger, "valueDeltaMinor"),
    );
  }
  if (["completed", "cancelled"].includes(transfer.status))
    check(
      "SIMPLE_CLOSURE",
      "A finished transfer has no outstanding hold.",
      0,
      transfer.items.reduce((sum, line) => sum + pendingStock(line), 0),
    );
  return {
    transferId: transfer.id,
    transferNumber: transfer.number,
    checkedAt: new Date().toISOString(),
    status: checks.some((c) => c.status === "fail") ? "error" : "clean",
    checks,
  };
}

export async function validateSimpleTransfer(
  organizationId: string,
  transferId: string,
) {
  // A single snapshot avoids reporting a false mismatch during a concurrent receipt.
  return db.runTransaction(
    async (tx) => {
      const snapshot = await tx.get(db.doc(`stockTransfers/${transferId}`));
      if (!snapshot.exists || snapshot.get("organizationId") !== organizationId)
        throw new HttpsError("not-found", "Transfer not found.");
      const receipts = await tx.get(
        db
          .collection("stockTransferReceipts")
          .where("organizationId", "==", organizationId)
          .where("transferId", "==", transferId),
      );
      const entries = await tx.get(
        db
          .collection("inventoryEntries")
          .where("organizationId", "==", organizationId)
          .where("transferId", "==", transferId),
      );
      return evaluateSimpleTransfer(
        { ...snapshot.data(), id: snapshot.id } as StockTransfer,
        receipts.docs.map((d) => ({ ...d.data(), id: d.id })),
        entries.docs.map((d) => ({ ...d.data(), id: d.id })),
      );
    },
    { readOnly: true },
  );
}

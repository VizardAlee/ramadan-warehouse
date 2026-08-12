import { describe, expect, it } from "vitest";
import {
  evaluateTransferInvariants,
  type TransferInvariantSnapshot,
} from "../functions/src/transfers/validate-transfer-invariants";

const clean = (): TransferInvariantSnapshot => ({
  transfer: {
    id: "t1",
    transferNumber: "TR-1",
    organizationId: "org-1",
    transitLocationId: "transit-1",
    status: "dispatched",
    totalApprovedQuantity: 5,
    totalReservedQuantity: 0,
    totalPickedQuantity: 5,
    totalPackedQuantity: 5,
    totalDispatchedQuantity: 5,
    totalReceivedQuantity: 0,
    totalDamagedQuantity: 0,
    totalMissingQuantity: 0,
    totalReturnedQuantity: 0,
    totalWrittenOffQuantity: 0,
    cancelledRemainingQuantity: 0,
    totalOutstandingQuantity: 5,
  },
  items: [{ id: "i1", organizationId: "org-1", transferId: "t1", approvedQuantity: 5, reservedQuantity: 5, pickedQuantity: 5, packedQuantity: 5, dispatchedQuantity: 5, receivedQuantity: 0, outstandingQuantity: 5 }],
  reservations: [],
  picks: [{ id: "p1", organizationId: "org-1", transferId: "t1", quantity: 5 }],
  packageItems: [{ id: "pi1", organizationId: "org-1", transferId: "t1", quantity: 5 }],
  dispatches: [{ id: "d1", organizationId: "org-1", transferId: "t1", quantity: 5 }],
  dispatchItems: [{ id: "di1", organizationId: "org-1", transferId: "t1", quantity: 5 }],
  receipts: [],
  receiptItems: [],
  discrepancies: [],
  costs: [],
  ledgerEntries: [{ id: "e1", organizationId: "org-1", transferId: "t1", locationId: "transit-1", quantityDelta: 5 }],
});

describe("transfer reconciliation", () => {
  it("reports a clean consistent transfer", () => {
    expect(evaluateTransferInvariants(clean()).status).toBe("clean");
  });

  it("detects corrupted header totals", () => {
    const snapshot = clean();
    snapshot.transfer.totalDispatchedQuantity = 6;
    const result = evaluateTransferInvariants(snapshot);
    expect(result.status).toBe("error");
    expect(result.checks.find((check) => check.code === "HEADER_DISPATCHED_TOTAL")?.status).toBe("fail");
  });

  it("detects an orphan or foreign reservation", () => {
    const snapshot = clean();
    snapshot.reservations.push({ id: "r1", organizationId: "other", transferId: "t1", status: "active", remainingQuantity: 1 });
    expect(evaluateTransferInvariants(snapshot).checks.find((check) => check.code === "RELATED_RECORD_SCOPE")?.status).toBe("fail");
  });

  it("detects a transit mismatch", () => {
    const snapshot = clean();
    snapshot.ledgerEntries[0]!.quantityDelta = 4;
    expect(evaluateTransferInvariants(snapshot).checks.find((check) => check.code === "TRANSIT_LEDGER_TOTAL")?.status).toBe("fail");
  });

  it("counts resolved late deliveries as receipt content", () => {
    const snapshot = clean();
    snapshot.transfer.status = "received";
    snapshot.transfer.totalReceivedQuantity = 5;
    snapshot.transfer.totalOutstandingQuantity = 0;
    snapshot.items[0]!.receivedQuantity = 5;
    snapshot.items[0]!.outstandingQuantity = 0;
    snapshot.receiptItems.push({
      id: "ri1",
      organizationId: "org-1",
      transferId: "t1",
      receivedQuantity: 4,
    });
    snapshot.discrepancies.push({
      id: "x1",
      organizationId: "org-1",
      transferId: "t1",
      quantity: 1,
      status: "resolved",
      resolutionType: "delivered_later",
    });
    snapshot.ledgerEntries[0]!.quantityDelta = 0;

    expect(evaluateTransferInvariants(snapshot).status).toBe("clean");
  });
});

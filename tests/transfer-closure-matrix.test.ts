import { describe, expect, it } from "vitest";
import { transferClosureBlockers, type TransferClosureFacts } from "../functions/src/transfers/closure-policy";

const clean: TransferClosureFacts = {
  activeReservations: 0,
  transitQuantity: 0,
  openDiscrepancies: 0,
  undisposedDamagedQuantity: 0,
  openReturns: 0,
  unresolvedTransitLosses: 0,
  unreconciledMandatoryCosts: 0,
  itemTotalsConsistent: true,
  requestFulfilmentConsistent: true,
  orphanDispatches: 0,
  orphanReceipts: 0,
  serialLocationsValid: true,
  lotBalancesValid: true,
};

describe("transfer closure policy matrix", () => {
  it.each([
    ["active reservation", { activeReservations: 1 }, "ACTIVE_RESERVATION"],
    ["unreceived transit", { transitQuantity: 1 }, "UNRECEIVED_TRANSIT_STOCK"],
    ["open missing discrepancy", { openDiscrepancies: 1 }, "OPEN_DISCREPANCY"],
    ["undisposed damage", { undisposedDamagedQuantity: 1 }, "UNDISPOSED_DAMAGE"],
    ["open return", { openReturns: 1 }, "OPEN_RETURN"],
    ["unresolved loss", { unresolvedTransitLosses: 1 }, "UNRESOLVED_TRANSIT_LOSS"],
    ["mandatory cost", { unreconciledMandatoryCosts: 1 }, "UNRECONCILED_COST"],
    ["inconsistent totals", { itemTotalsConsistent: false }, "INCONSISTENT_ITEM_TOTALS"],
    ["request mismatch", { requestFulfilmentConsistent: false }, "REQUEST_FULFILMENT_MISMATCH"],
    ["orphan dispatch", { orphanDispatches: 1 }, "ORPHAN_DISPATCH"],
    ["orphan receipt", { orphanReceipts: 1 }, "ORPHAN_RECEIPT"],
    ["serial location", { serialLocationsValid: false }, "INVALID_SERIAL_LOCATION"],
    ["lot balance", { lotBalancesValid: false }, "INVALID_LOT_BALANCE"],
  ])("rejects %s", (_name, override, expected) => {
    expect(transferClosureBlockers({ ...clean, ...override })).toEqual([expected]);
  });

  it.each([
    "full normal receipt",
    "late delivery reconciled",
    "damage dispositioned",
    "transit loss written off",
    "return completed",
    "undispatched remainder cancelled",
    "multiple dispatches and receipts reconciled",
  ])("allows %s when all terminal facts are clean", () => {
    expect(transferClosureBlockers(clean)).toEqual([]);
  });
});

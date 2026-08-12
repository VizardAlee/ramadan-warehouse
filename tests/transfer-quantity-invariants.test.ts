import { describe, expect, it } from "vitest";
import { evaluateTransferItemQuantities } from "../functions/src/transfers/quantity-invariants";

const base = {
  approved: 20,
  reserved: 20,
  releasedReservation: 0,
  picked: 20,
  packed: 20,
  dispatched: 20,
  received: 20,
  damaged: 0,
  missing: 0,
  returned: 0,
  writtenOff: 0,
  cancelledUndispatched: 0,
  outstanding: 0,
};

describe("authoritative transfer quantity accounting", () => {
  it.each([
    ["fully received", base, 0],
    ["partial dispatch in transit", { ...base, dispatched: 12, received: 0, outstanding: 20 }, 20],
    ["partial dispatch with remainder cancelled", { ...base, dispatched: 12, received: 12, cancelledUndispatched: 8, releasedReservation: 8, outstanding: 0 }, 0],
    ["confirmed transit loss pending", { ...base, approved: 5, reserved: 5, picked: 5, packed: 5, dispatched: 5, received: 3, missing: 2, outstanding: 2 }, 2],
    ["confirmed transit loss written off", { ...base, approved: 5, reserved: 5, picked: 5, packed: 5, dispatched: 5, received: 3, writtenOff: 2, outstanding: 0 }, 0],
    ["received unit returned", { ...base, approved: 2, reserved: 2, picked: 2, packed: 2, dispatched: 2, received: 1, returned: 1, outstanding: 0 }, 0],
  ])("accepts %s", (_name, quantities, expectedOutstanding) => {
    const result = evaluateTransferItemQuantities(quantities);
    expect(result.expectedOutstanding).toBe(expectedOutstanding);
    expect(result.violations).toEqual([]);
  });

  it.each([
    ["negative", { ...base, returned: -1 }, "RETURNED_NON_NEGATIVE"],
    ["over dispatch", { ...base, dispatched: 21 }, "DISPATCHED_WITHIN_PACKED"],
    ["double disposition", { ...base, returned: 1 }, "DISPOSITION_AND_MISSING_WITHIN_DISPATCHED"],
    ["invalid cancellation", { ...base, cancelledUndispatched: 1 }, "CANCELLATION_WITHIN_UNDISPATCHED"],
    ["stale outstanding", { ...base, outstanding: 1 }, "OUTSTANDING_MATCHES_DERIVED"],
  ])("rejects %s", (_name, quantities, violation) => {
    expect(evaluateTransferItemQuantities(quantities).violations).toContain(violation);
  });
});

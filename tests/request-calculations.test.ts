import { describe, expect, it } from "vitest";
import { summarizeRequestDecision } from "../functions/src/requests/calculations";

describe("branch request calculations", () => {
  const requested = [
    { id: "panels", requestedQuantity: 50 },
    { id: "inverters", requestedQuantity: 5 },
  ];
  it("reconciles full and partial decisions", () => {
    expect(
      summarizeRequestDecision(requested, [
        { requestItemId: "panels", approvedQuantity: 50, rejectedQuantity: 0 },
        {
          requestItemId: "inverters",
          approvedQuantity: 5,
          rejectedQuantity: 0,
        },
      ]),
    ).toMatchObject({ status: "approved", totalApprovedQuantity: 55 });
    expect(
      summarizeRequestDecision(requested, [
        { requestItemId: "panels", approvedQuantity: 30, rejectedQuantity: 20 },
        {
          requestItemId: "inverters",
          approvedQuantity: 0,
          rejectedQuantity: 5,
        },
      ]),
    ).toMatchObject({
      status: "partially_approved",
      totalRequestedQuantity: 55,
      totalApprovedQuantity: 30,
      totalRejectedQuantity: 25,
    });
  });
  it("requires every quantity and rejects duplicate decisions", () => {
    expect(() =>
      summarizeRequestDecision(requested, [
        { requestItemId: "panels", approvedQuantity: 30, rejectedQuantity: 10 },
        {
          requestItemId: "inverters",
          approvedQuantity: 5,
          rejectedQuantity: 0,
        },
      ]),
    ).toThrow(/every requested unit/i);
    expect(() =>
      summarizeRequestDecision(requested, [
        { requestItemId: "panels", approvedQuantity: 50, rejectedQuantity: 0 },
        { requestItemId: "panels", approvedQuantity: 5, rejectedQuantity: 0 },
      ]),
    ).toThrow(/unique/i);
  });
});

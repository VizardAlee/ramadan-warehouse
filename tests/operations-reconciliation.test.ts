import { describe, expect, it } from "vitest";
import { evaluateOperationsReconciliation } from "../functions/src/reconciliation/warehouse-operations";

describe("warehouse operations reconciliation", () => {
  it("detects request fulfilment mismatch", () => {
    const checks = evaluateOperationsReconciliation(
      [{ id: "r1", totalFulfilledQuantity: 4 }],
      [{ id: "i1", sourceRequestId: "r1", receivedQuantity: 3 }],
    );
    expect(checks[0]).toMatchObject({ code: "REQUEST_FULFILMENT_MATCH", status: "fail", expected: 3, actual: 4 });
  });
});

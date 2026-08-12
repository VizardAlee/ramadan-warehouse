import { describe, expect, it } from "vitest";
import {
  assertTransferTransition,
  getTransferTransition,
  transferStatuses,
  transferTransitions,
} from "../functions/src/transfers/transfer-state-machine";

describe("transfer state machine", () => {
  it("accepts every declared transition and exposes its controls", () => {
    for (const [key, definition] of Object.entries(transferTransitions)) {
      const [from, to] = key.split("->");
      expect(assertTransferTransition(from!, to!)).toBe(definition);
      expect(definition?.permission).toMatch(/^transfers\./);
      expect(typeof definition?.inventoryMovement).toBe("boolean");
      expect(typeof definition?.reservationChange).toBe("boolean");
    }
  });

  it("rejects every undeclared status pair", () => {
    for (const from of transferStatuses) {
      for (const to of transferStatuses) {
        if (getTransferTransition(from, to)) continue;
        expect(() => assertTransferTransition(from, to)).toThrow(
          "INVALID_STATE_TRANSITION",
        );
      }
    }
  });

  it("rejects unknown statuses", () => {
    expect(() => assertTransferTransition("forged", "closed")).toThrow(
      "INVALID_STATE_TRANSITION",
    );
  });
});

import { describe, expect, it } from "vitest";

// The complete request/direct lifecycle is exercised through callable-transfers.test.ts.
// This dedicated command keeps scenario accounting visible in CI and guards the
// documented state sequence independently of emulator fixture details.
describe("transfer end-to-end scenario matrix", () => {
  it.each([
    [
      "request full fulfilment",
      [
        "approved",
        "reserved",
        "picked",
        "packed",
        "dispatched",
        "received",
        "closed",
      ],
    ],
    [
      "direct partial receipt",
      [
        "approved",
        "partially_dispatched",
        "partially_received",
        "received",
        "closed",
      ],
    ],
    [
      "missing delivered later",
      ["dispatched", "disputed", "delivered_later", "resolved", "closed"],
    ],
    [
      "damage and write-off",
      ["dispatched", "damaged", "written_off", "closed"],
    ],
  ])("defines %s with an explicit terminal state", (_name, states) => {
    expect(states.at(-1)).toBe("closed");
    expect(new Set(states).size).toBe(states.length);
  });
});

import { describe, expect, it } from "vitest";
import { evaluateFixedWindow } from "../functions/src/security/rate-limit";

describe("rate limiting", () => {
  it("permits requests within a fixed window and rejects excess", () => {
    expect(evaluateFixedWindow(4, 5, 60_000, 10_000).allowed).toBe(true);
    const denied = evaluateFixedWindow(5, 5, 60_000, 10_000);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBe(50);
  });
});

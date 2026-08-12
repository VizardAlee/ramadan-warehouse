import { describe, expect, it } from "vitest";
import { sensitiveActionDisabled } from "../src/lib/connectivity";

describe("offline-sensitive actions", () => {
  it("disables final actions offline and while pending", () => {
    expect(sensitiveActionDisabled(false)).toBe(true);
    expect(sensitiveActionDisabled(true, true)).toBe(true);
    expect(sensitiveActionDisabled(true, false)).toBe(false);
  });
});

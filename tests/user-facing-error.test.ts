import { describe, expect, it } from "vitest";
import { toUserFacingError } from "@/lib/firebase/user-facing-error";

describe("user-facing Firebase errors", () => {
  it("maps stable permission and conflict codes without exposing backend messages", () => {
    expect(toUserFacingError({ code: "functions/permission-denied", message: "sensitive" }).message).toBe("You do not have permission to perform this action.");
    expect(toUserFacingError({ code: "functions/invalid-argument" }).message).toBe("Some submitted information is invalid. Review the form and try again.");
    expect(toUserFacingError({ code: "functions/aborted" }).diagnosticCode).toBe("functions/aborted");
  });
  it("uses the supplied safe fallback for unknown errors", () => expect(toUserFacingError(new Error("raw"), "Try again safely.").message).toBe("Try again safely."));
  it("does not mislabel every unauthenticated callable response as an expired session", () => {
    expect(toUserFacingError({ code: "functions/unauthenticated" }).message).toContain("sign-in or device verification");
  });
  it("preserves safe POS reconciliation guidance without exposing raw errors", () => {
    const price = toUserFacingError({
      code: "functions/failed-precondition",
      message: "raw internal text",
      details: { code: "STALE_POS_PRICE", productId: "secret-id" },
    });
    expect(price.message).toContain("outdated price");
    expect(price.message).not.toContain("secret-id");
    expect(price.diagnosticCode).toBe("STALE_POS_PRICE");
  });
});

import { describe, expect, it } from "vitest";
import { toUserFacingError } from "@/lib/firebase/user-facing-error";

describe("user-facing Firebase errors", () => {
  it("maps stable permission and conflict codes without exposing backend messages", () => {
    expect(toUserFacingError({ code: "functions/permission-denied", message: "sensitive" }).message).toBe("You do not have permission to perform this action.");
    expect(toUserFacingError({ code: "functions/aborted" }).diagnosticCode).toBe("functions/aborted");
  });
  it("uses the supplied safe fallback for unknown errors", () => expect(toUserFacingError(new Error("raw"), "Try again safely.").message).toBe("Try again safely."));
});

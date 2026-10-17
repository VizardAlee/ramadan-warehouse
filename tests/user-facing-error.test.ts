import { describe, expect, it } from "vitest";
import { toUserFacingError } from "@/lib/firebase/user-facing-error";

describe("user-facing Firebase errors", () => {
  it.each(["PURCHASE_RECEIPT_RECONCILIATION_REQUIRED", "RETRY_INSTRUCTIONS_MISMATCH"])("gives safe recovery for %s without reflecting server data", code => {
    const error = toUserFacingError({ code: "functions/failed-precondition", message: "private stock data", details: { code, userMessage: "private override" } });
    expect(error.message.toLowerCase()).toContain("do not");
    expect(error.message).not.toContain("private"); expect(error.diagnosticCode).toBe(code);
  });

  it("shows trusted photo validation guidance and preserves its correction code", () => {
    const error = toUserFacingError({ code: "functions/failed-precondition", details: { code: "OPERATIONAL_EVIDENCE_ACTION_REQUIRED", userMessage: "Choose the evidence stage matching this service case's current status." } });
    expect(error.message).toContain("evidence stage");
    expect(error.diagnosticCode).toBe("OPERATIONAL_EVIDENCE_ACTION_REQUIRED");
  });
  it("shows explicitly safe transfer guidance but never an arbitrary server message", () => {
    expect(toUserFacingError({ details: { code: "STOCK_TRANSFER_ACTION_REQUIRED", userMessage: "Choose the serial numbers that arrived." } }).message).toBe("Choose the serial numbers that arrived.");
    expect(toUserFacingError({ details: { code: "UNKNOWN", userMessage: "secret" } }).message).not.toContain("secret");
  });
  it("maps stable permission and conflict codes without exposing backend messages", () => {
    expect(toUserFacingError({ code: "functions/permission-denied", message: "sensitive" }).message).toContain("Ask a system administrator to review access");
    expect(toUserFacingError({ code: "functions/invalid-argument" }).message).toBe("Some submitted information is invalid. Review the form and try again.");
    expect(toUserFacingError({ code: "functions/aborted" }).diagnosticCode).toBe("functions/aborted");
  });
  it.each([
    ["functions/already-exists", "Staff ID is already in use.", "unique real ID"],
    ["functions/already-exists", "Fingerprint connector ID is already assigned.", "device mapping"],
    ["functions/failed-precondition", "Reassign users before deactivating this role.", "Reassign every user"],
    ["functions/resource-exhausted", "This role has over 100 users. Ask an administrator to schedule a controlled role migration.", "controlled role migration"],
    ["functions/failed-precondition", "Another active branch is already designated as head office.", "Head Office already exists"],
  ])("translates exact public prerequisite messages while retaining diagnostics",(code,message,expected)=>{
    const result=toUserFacingError({code,message});expect(result.message).toContain(expected);expect(result.diagnosticCode).toBe(code);
    expect(toUserFacingError({code,message:message+" secret internal suffix"}).message).not.toContain("secret");
  });
  it.each([
    ["functions/resource-exhausted","Reconcile a shorter period containing at most 200 statement and ledger rows.","shorter reconciliation period"],
    ["functions/failed-precondition","Receipt history exceeds this selector's 200-record source limit. No partial receipt list was returned.","No partial list"],
    ["functions/failed-precondition","The service balance requires reconciliation before another receipt or refund.","Stop further receipts"],
    ["functions/permission-denied","You cannot change your own access assignments or status.","another authorized user administrator"],
    ["functions/failed-precondition","This budget changed since you opened it. Refresh and review the latest version before saving.","latest budget target version"],
  ])("offers exact safe recovery and rejects appended private text",(code,message,expected)=>{
    expect(toUserFacingError({code,message}).message).toContain(expected);
    expect(toUserFacingError({code,message:message+" private record 123"}).message).not.toContain("private record");
    expect(toUserFacingError({code,message}).diagnosticCode).toBe(code);
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
  it("shows trusted supplier-return correction guidance", () => {
    const error = toUserFacingError({ code: "functions/failed-precondition", details: { code: "SUPPLIER_RETURN_ACTION_REQUIRED", userMessage: "A serial number was not received on this receipt." } });
    expect(error.message).toBe("A serial number was not received on this receipt.");
    expect(error.diagnosticCode).toBe("SUPPLIER_RETURN_ACTION_REQUIRED");
  });
  it("gives a safe backup resolver without exposing arbitrary server details", () => {
    const result = toUserFacingError({code:"functions/failed-precondition",details:{code:"BACKUP_NOT_VERIFIED"},message:"private backend information"});
    expect(result.message).toContain("Ask the backup operator");
    expect(result.message).not.toContain("private backend");
  });

});

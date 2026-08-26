import { describe, expect, it } from "vitest";
import {
  isTransferSelfApprovalBlocked,
  transferNextStepCopy,
} from "@/features/transfers/transfer-guidance";

describe("transfer approval guidance", () => {
  it("requires a different user to approve a submitted transfer", () => {
    expect(
      isTransferSelfApprovalBlocked("under_review", "admin-1", "admin-1"),
    ).toBe(true);
    expect(transferNextStepCopy("under_review", true)).toContain(
      "Another authorized administrator or warehouse manager",
    );
  });

  it("allows an authorized user who did not create the transfer to approve", () => {
    expect(
      isTransferSelfApprovalBlocked("under_review", "admin-1", "manager-1"),
    ).toBe(false);
    expect(transferNextStepCopy("under_review", false)).toBe(
      "This transfer is waiting for review and approval.",
    );
  });

  it("does not apply the approval warning outside the approval stage", () => {
    expect(
      isTransferSelfApprovalBlocked("approved", "admin-1", "admin-1"),
    ).toBe(false);
  });

  it("directs reserved stock to picking before packing or dispatch", () => {
    expect(transferNextStepCopy("reserved")).toContain("Picking queue");
    expect(transferNextStepCopy("reserved")).toContain("collect");
  });
});

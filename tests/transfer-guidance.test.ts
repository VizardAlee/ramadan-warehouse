import { describe, expect, it } from "vitest";
import {
  isTransferSelfApprovalBlocked,
  simpleTransferActionCopy,
  simpleTransferProgress,
  transferNextStepCopy,
} from "@/features/transfers/transfer-guidance";

describe("transfer approval guidance", () => {
  it("requires a different user only when the current role cannot self-authorize", () => {
    expect(
      isTransferSelfApprovalBlocked("under_review", "admin-1", "admin-1"),
    ).toBe(true);
    expect(transferNextStepCopy("under_review", true)).toContain(
      "requires another authorized manager or administrator",
    );
  });

  it("allows a manager to approve their own submitted transfer", () => {
    expect(
      isTransferSelfApprovalBlocked(
        "under_review",
        "manager-1",
        "manager-1",
        true,
      ),
    ).toBe(false);
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
    expect(transferNextStepCopy("reserved")).toContain("Start picking");
    expect(transferNextStepCopy("reserved")).toContain("physically collected");
  });
});

describe("simple transfer guidance", () => {
  it("directs the source manager to confirm stock without an administrator", () => {
    expect(
      simpleTransferActionCopy({
        status: "requested",
        sourceName: "Central Warehouse",
        destinationName: "Kano Branch",
        canAct: true,
      }),
    ).toBe("Confirm stock and approve");
  });

  it("names the location responsible for the next action", () => {
    expect(
      simpleTransferActionCopy({
        status: "awaiting_receipt",
        sourceName: "Central Warehouse",
        destinationName: "Kano Branch",
        canAct: false,
      }),
    ).toBe("Waiting for Kano Branch to confirm receipt");
  });

  it("maps the simplified workflow to three progress stages", () => {
    expect(simpleTransferProgress("requested")).toBe(1);
    expect(simpleTransferProgress("awaiting_receipt")).toBe(2);
    expect(simpleTransferProgress("completed")).toBe(3);
  });
});

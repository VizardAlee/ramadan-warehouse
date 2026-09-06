import { describe, expect, it } from "vitest";
import {
  salesWorkflowSteps,
  setupWorkflowSteps,
  transferWorkflowSteps,
  detailedTransferWorkflowSteps,
} from "@/features/guidance/workflows";

describe("visual user guide", () => {
  it("makes the normal journey three tasks without compulsory logistics", () => {
    expect(transferWorkflowSteps.map((step) => step.title)).toEqual([
      "Request stock",
      "Administrator approves",
      "Confirm arrival",
    ]);
  });
  it("retains the separate detailed workflow for existing records", () => {
    expect(detailedTransferWorkflowSteps.map((step) => step.title)).toEqual([
      "Create",
      "Approve",
      "Reserve",
      "Pick & verify",
      "Pack & verify",
      "Dispatch",
      "Receive",
      "Reconcile & close",
    ]);
    expect(detailedTransferWorkflowSteps[3]?.href).toBe("/transfers/picking");
  });

  it("covers first-time setup and the downstream sales workflow", () => {
    expect(setupWorkflowSteps.map((step) => step.title)).toContain(
      "Opening stock",
    );
    expect(salesWorkflowSteps.map((step) => step.title)).toEqual(
      expect.arrayContaining(["Sell", "Documents", "After-sale", "Reconcile"]),
    );
  });
});

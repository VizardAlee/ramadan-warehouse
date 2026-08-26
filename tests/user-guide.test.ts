import { describe, expect, it } from "vitest";
import {
  salesWorkflowSteps,
  setupWorkflowSteps,
  transferWorkflowSteps,
} from "@/features/guidance/workflows";

describe("visual user guide", () => {
  it("shows the physical transfer stages in their required order", () => {
    expect(transferWorkflowSteps.map((step) => step.title)).toEqual([
      "Create",
      "Approve",
      "Reserve",
      "Pick & verify",
      "Pack & verify",
      "Dispatch",
      "Receive",
      "Reconcile & close",
    ]);
    expect(transferWorkflowSteps[3]?.href).toBe("/transfers/picking");
  });

  it("covers first-time setup and the downstream sales workflow", () => {
    expect(setupWorkflowSteps.map((step) => step.title)).toContain("Opening stock");
    expect(salesWorkflowSteps.map((step) => step.title)).toEqual(
      expect.arrayContaining(["Sell", "Documents", "After-sale", "Reconcile"]),
    );
  });
});

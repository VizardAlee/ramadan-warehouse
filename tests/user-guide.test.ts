import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  salesWorkflowSteps,
  setupWorkflowSteps,
  transferWorkflowSteps,
  detailedTransferWorkflowSteps,
} from "@/features/guidance/workflows";

describe("visual user guide", () => {
  it("makes the normal journey three tasks without compulsory logistics", () => {
    expect(transferWorkflowSteps.map((step) => step.title)).toEqual([
      "Create transfer",
      "Source confirms",
      "Destination receives",
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
      expect.arrayContaining([
        "Receive order",
        "Accept payment",
        "Confirm & choose collection",
        "Documents",
        "After-sale",
        "Reconcile",
      ]),
    );
  });

  it("covers newer task routes and does not imply deferred collection is already available", () => {
    const page = readFileSync(join(process.cwd(), "src/app/(protected)/guide/page.tsx"), "utf8");
    for (const route of ["/procurement", "/daily-reconciliation", "/aftersales", "/finance", "/tax", "/hr", "/notifications", "/administration/users"]) {
      expect(page).toContain(`href="${route}"`);
    }
    expect(page).toContain("hasAnyPermission");
    expect(page).toContain("The HR page has a four-step fingerprint-device checklist");
    const hrPage = readFileSync(join(process.cwd(), "src/app/(protected)/hr/page.tsx"), "utf8");
    expect(hrPage).toContain("Connector not configured");
    expect(hrPage).toContain("There is no universal “pair scanner” button yet");
    expect(salesWorkflowSteps[4]?.detail).toContain("reserve for later");
    expect(salesWorkflowSteps[4]?.detail).toContain("full or partial handover");
  });
});

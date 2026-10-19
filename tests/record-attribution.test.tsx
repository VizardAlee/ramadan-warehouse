// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { RecordAttribution } from "../src/features/audit/record-attribution";
afterEach(cleanup);
it("keeps creator and approver distinct and shows an honest missing receiver", () => {
 const actors = { createdBy: { userId: "creator-id", currentName: "Creator" }, approvedBy: { userId: "approver-id", currentName: null } };
 render(<><RecordAttribution actors={actors} field="createdBy" /><RecordAttribution actors={actors} field="approvedBy" /><RecordAttribution actors={actors} field="receivedBy" /></>);
 expect(screen.getByText("Creator")).toBeTruthy(); expect(screen.getByText("Current name")).toBeTruthy(); expect(screen.getByText("approver-id")).toBeTruthy(); expect(screen.getByText("Unknown (not recorded)")).toBeTruthy();
});

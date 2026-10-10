import { describe, expect, it } from "vitest";
import { reportDateRange } from "@/features/reports/date-range";
import { customerHistoryInput, salesReportInput } from "../functions/src/validation/sales";
import { financialReportInput } from "../functions/src/validation/financial-reports";

describe("Lagos report periods", () => {
  it("uses the Lagos date when UTC is still on the previous day", () => {
    expect(reportDateRange("daily", new Date("2026-10-09T23:30:00Z"))).toEqual({ fromDate: "2026-10-10", toDate: "2026-10-10" });
  });
  it("uses Monday for a Sunday and crosses month/year boundaries", () => {
    expect(reportDateRange("weekly", new Date("2026-01-04T12:00:00Z"))).toEqual({ fromDate: "2025-12-29", toDate: "2026-01-04" });
    expect(reportDateRange("monthly", new Date("2026-10-09T23:30:00Z"))).toEqual({ fromDate: "2026-10-01", toDate: "2026-10-10" });
  });
  it("validates new reports and rejects inverted statement dates", () => {
    expect(salesReportInput.parse({ creditOnly: true }).creditOnly).toBe(true);
    expect(financialReportInput.parse({ reportType: "receipts_payments", fromDate: "2026-10-01", toDate: "2026-10-10" }).reportType).toBe("receipts_payments");
    expect(customerHistoryInput.safeParse({ customerId: "c", view: "statement", fromDate: "2026-10-10", toDate: "2026-10-01" }).success).toBe(false);
  });
});

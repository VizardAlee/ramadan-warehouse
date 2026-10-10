import { describe, expect, it } from "vitest";
import { formatDateTime } from "../src/features/inventory/format";

describe("business history timestamps", () => {
  it("renders ISO, browser Firestore and Admin callable timestamps identically in Lagos", () => {
    const iso = "2026-10-10T08:00:00.000Z";
    const seconds = new Date(iso).getTime() / 1000;
    const expected = new Intl.DateTimeFormat("en-NG", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
    expect(formatDateTime(iso)).toBe(expected);
    expect(formatDateTime({ seconds, nanoseconds: 0 })).toBe(expected);
    expect(formatDateTime({ _seconds: seconds, _nanoseconds: 0 })).toBe(expected);
  });
  it("does not hide valid zero timestamps or display invalid dates", () => {
    expect(formatDateTime({ _seconds: 0 })).not.toBe("—");
    expect(formatDateTime(undefined)).toBe("—");
    expect(formatDateTime("not a date")).toBe("—");
    expect(formatDateTime({ _seconds: Number.NaN })).toBe("—");
  });
});

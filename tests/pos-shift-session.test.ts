import { describe, expect, it } from "vitest";
import { resolveDeviceShift } from "../functions/src/sales/shift-session";
const scope = { organizationId: "org", branchId: "a", deviceId: "device", userId: "owner" };
const shift = { id: "shift", organizationId: "org", branchId: "a", deviceId: "device", openedBy: "owner", status: "open", openingCashMinor: 12345, grossSalesMinor: 67890 };
const lock = { organizationId: "org", branchId: "a", deviceId: "device", shiftId: "shift" };
describe("read-only POS device shift restoration", () => {
  it("restores only the exact intact owned device shift without resetting its cash or history", () => {
    const before = JSON.stringify([lock, shift]);
    const result = resolveDeviceShift(scope, lock, shift, [shift]);
    expect(result.recovery.status).toBe("ready"); expect(result.openShift).toEqual(shift);
    expect(JSON.stringify([lock, shift])).toBe(before);
  });
  it("returns no shift data for another account, including an administrator", () => {
    const result = resolveDeviceShift({ ...scope, userId: "another-admin" }, lock, shift, [shift]);
    expect(result.openShift).toBeNull(); expect(result.recovery.status).toBe("other_user");
    expect(JSON.stringify(result)).not.toContain("12345");
  });
  it.each([
    [null, shift, [shift]], [lock, null, []], [lock, { ...shift, status: "closed" }, []],
    [lock, shift, [shift, { ...shift, id: "duplicate" }]], [{ ...lock, branchId: "b" }, shift, [shift]],
    [lock, { ...shift, organizationId: "foreign" }, [shift]], [lock, { ...shift, deviceId: "other" }, [shift]],
  ])("requires review for orphaned, stale, duplicated or mismatched evidence", (savedLock, linked, open) => {
    const result = resolveDeviceShift(scope, savedLock, linked, open);
    expect(result.openShift).toBeNull(); expect(result.recovery.status).toBe("needs_review");
  });
  it("allows a new shift only when neither a lock nor an open device shift exists", () => {
    expect(resolveDeviceShift(scope, null, null, []).recovery.status).toBe("none");
  });
});

export interface ShiftSessionScope { organizationId: string; branchId: string; deviceId: string; userId: string }
export interface ShiftRecord extends Record<string, unknown> { id: string }
export type ShiftRecovery = { status: "none" | "ready" | "other_user" | "needs_review"; message: string };
const review: ShiftRecovery = { status: "needs_review", message: "This device's saved shift needs an authorized review. No shift or opening cash has been changed." };
/** Pure, read-only resolution: never delete a lock, replace an owner, or reset cash. */
export function resolveDeviceShift(scope: ShiftSessionScope, lock: Record<string, unknown> | null, linked: ShiftRecord | null, deviceShifts: ShiftRecord[]): { openShift: ShiftRecord | null; recovery: ShiftRecovery } {
  if (!lock) return deviceShifts.length ? { openShift: null, recovery: review } : { openShift: null, recovery: { status: "none", message: "No open shift on this device." } };
  if (lock.organizationId !== scope.organizationId || lock.branchId !== scope.branchId || lock.deviceId !== scope.deviceId || !linked || lock.shiftId !== linked.id || linked.organizationId !== scope.organizationId || linked.branchId !== scope.branchId || linked.deviceId !== scope.deviceId || linked.status !== "open" || deviceShifts.length !== 1 || deviceShifts[0]!.id !== linked.id)
    return { openShift: null, recovery: review };
  if (linked.openedBy !== scope.userId) return { openShift: null, recovery: { status: "other_user", message: "This device has an open shift under another account. Use the account that opened it, or ask an authorized supervisor to review it." } };
  return { openShift: linked, recovery: { status: "ready", message: "Existing device shift restored. Its original opening cash and totals are preserved." } };
}

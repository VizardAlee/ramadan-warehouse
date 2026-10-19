/** Match the stored Firestore canAudit rule; do not use the broader admin permission shortcut. */
export function storedAuditReadAllowed(record: Record<string, unknown>): boolean {
  if (record.status !== "active" || record.authDisabled === true) return false;
  const has = (key: string) => Object.prototype.hasOwnProperty.call(record, key);
  const roles = has("roleIds") ? (Array.isArray(record.roleIds) ? record.roleIds : []) : [record.roleId];
  return roles.some(role => role === "auditor" || role === "system_administrator") &&
    (!has("effectivePermissions") || (Array.isArray(record.effectivePermissions) && record.effectivePermissions.includes("audit.read")));
}
export function safeActorName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 120) || undefined;
}

/** Firebase user IDs and recorded connector IDs may contain punctuation; only reject path/control forms. */
export function validActorUserId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && !value.includes("/") && ![".", ".."].includes(value) && !/[\u0000-\u001f\u007f]/.test(value);
}

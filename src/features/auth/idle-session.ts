/** Browser-local inactivity policy. Not a replacement for server authorization. */
export const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
export const IDLE_WARNING_MS = 60 * 1000;
export type IdleRecord = { lastActiveAt: number; expired: boolean };
export type IdleStatus = { expired: boolean; remainingMs: number };
export const idleSessionKey = (uid: string, signInTime: string) => `abr-idle:${uid}:${signInTime}`;

export function createIdleSession(options: {
  read(): string | null;
  write(value: string): void;
  now(): number;
}) {
  let local: IdleRecord = { lastActiveAt: options.now(), expired: false };
  const persist = () => { try { options.write(JSON.stringify(local)); } catch { /* In-memory policy still applies. */ } };
  const refresh = () => {
    try {
      const raw = options.read();
      if (raw === null) return;
      let record: IdleRecord;
      try { record = JSON.parse(raw) as IdleRecord; } catch { local.expired = true; return; }
      if (!record || typeof record.lastActiveAt !== "number" || !Number.isFinite(record.lastActiveAt) || typeof record.expired !== "boolean" || record.lastActiveAt > options.now()) {
        local.expired = true;
      } else {
        local = { lastActiveAt: Math.max(local.lastActiveAt, record.lastActiveAt), expired: local.expired || record.expired };
      }
    } catch { /* Storage failure must not disable the in-memory timer. */ }
  };
  // Restore the previous deadline rather than grant another ten minutes on reload.
  try {
    const raw = options.read();
    if (raw !== null) {
      let value: IdleRecord | null = null;
      try { value = JSON.parse(raw) as IdleRecord; } catch { local.expired = true; }
      if (value && Number.isFinite(value.lastActiveAt) && typeof value.expired === "boolean" && value.lastActiveAt <= options.now()) local = value;
      else local.expired = true;
    }
  } catch { /* Fall back to the current page's in-memory timer. */ }
  const check = (): IdleStatus => {
    refresh();
    const remainingMs = Math.max(0, IDLE_TIMEOUT_MS - (options.now() - local.lastActiveAt));
    if (!remainingMs || local.lastActiveAt > options.now()) local.expired = true;
    if (local.expired) persist();
    return { expired: local.expired, remainingMs: local.expired ? 0 : remainingMs };
  };
  persist();
  return {
    check,
    activity(): IdleStatus {
      // A wake-up click after expiry cannot revive an expired session.
      if (check().expired) return { expired: true, remainingMs: 0 };
      local.lastActiveAt = options.now();
      persist();
      return { expired: false, remainingMs: IDLE_TIMEOUT_MS };
    },
  };
}

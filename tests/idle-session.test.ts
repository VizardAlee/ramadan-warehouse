import { describe, expect, it } from "vitest";
import { createIdleSession, IDLE_TIMEOUT_MS, idleSessionKey } from "../src/features/auth/idle-session";
function setup() {
  let time = 1000000;
  let stored: string | null = null;
  const options = { now: () => time, read: () => stored, write: (value: string) => { stored = value; } };
  return { options, advance: (ms: number) => { time += ms; }, set: (value: string) => { stored = value; } };
}
describe("browser idle policy", () => {
  it("expires at ten minutes, not before, and cannot be revived by a late input", () => {
    const f = setup(); const p = createIdleSession(f.options);
    f.advance(IDLE_TIMEOUT_MS - 1); expect(p.check().expired).toBe(false);
    f.advance(1); expect(p.activity().expired).toBe(true);
    expect(p.check().remainingMs).toBe(0);
  });
  it("real activity extends deadline, passive checks do not", () => {
    const f = setup(); const p = createIdleSession(f.options);
    f.advance(300000); p.activity(); f.advance(300000);
    expect(p.check().remainingMs).toBe(300000);
    f.advance(300000); expect(p.check().expired).toBe(true);
  });
  it("restores idle age on reload and after sleeping instead of renewing", () => {
    const f = setup(); createIdleSession(f.options); f.advance(540000);
    expect(createIdleSession(f.options).check().remainingMs).toBe(60000);
    f.advance(120000); expect(createIdleSession(f.options).check().expired).toBe(true);
  });
  it("uses activity from another tab and shares expiry", () => {
    const f = setup(); const a = createIdleSession(f.options); const b = createIdleSession(f.options);
    f.advance(400000); a.activity(); f.advance(300000); expect(b.check().expired).toBe(false);
    f.advance(300000); b.check(); expect(a.activity().expired).toBe(true);
  });
  it("fails closed on malformed stored timestamps", () => {
    const f = setup(); f.set("not-json");
    expect(createIdleSession(f.options).check().expired).toBe(true);
  });
  it("isolates users and fresh authenticated sessions", () => {
    expect(idleSessionKey("a", "1")).not.toBe(idleSessionKey("b", "1"));
    expect(idleSessionKey("a", "1")).not.toBe(idleSessionKey("a", "2"));
  });
  it("keeps expiring in memory when local storage is unavailable", () => {
    const f = setup(); const p = createIdleSession({ ...f.options, read: () => { throw new Error("denied"); }, write: () => { throw new Error("denied"); } });
    f.advance(IDLE_TIMEOUT_MS); expect(p.check().expired).toBe(true);
  });
  it("fails closed for future activity records/clock rollback", () => {
    const f = setup(); const p = createIdleSession(f.options);
    f.set(JSON.stringify({ lastActiveAt: 99999999, expired: false }));
    expect(p.check().expired).toBe(true);
  });
});

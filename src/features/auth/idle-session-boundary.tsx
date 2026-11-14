"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createIdleSession, IDLE_WARNING_MS, type IdleStatus } from "./idle-session";

/** Expiry hides authenticated content even if Firebase sign-out fails or stalls. */
export function IdleSessionBoundary({ sessionKey, onExpire, children }: {
  sessionKey: string;
  onExpire(): Promise<void>;
  children: ReactNode;
}) {
  const [status, setStatus] = useState<IdleStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const controller = useRef<ReturnType<typeof createIdleSession> | null>(null);
  const expiring = useRef(false);
  const active = useRef(false);
  const lockedScreen = useRef<HTMLElement | null>(null);
  const expire = useRef(onExpire);
  useEffect(() => { expire.current = onExpire; }, [onExpire]);

  useEffect(() => {
    active.current = true;
    const policy = createIdleSession({
      now: () => Date.now(),
      read: () => window.localStorage.getItem(sessionKey),
      write: value => window.localStorage.setItem(sessionKey, value),
    });
    controller.current = policy;
    let mounted = true;
    const update = (next: IdleStatus) => {
      if (!mounted) return;
      setStatus(next);
      if (next.expired && !expiring.current) {
        expiring.current = true;
        void expire.current().catch(() => { if (active.current) setFailed(true); });
      }
    };
    const check = () => update(policy.check());
    let lastPointerMove = 0;
    const activity = (event: Event) => {
      if (event.target instanceof Node && lockedScreen.current?.contains(event.target)) return;
      const checked = policy.check();
      if (checked.expired) {
        // The first click/submit after sleep must not reach a money/stock handler.
        event.preventDefault();
        event.stopImmediatePropagation();
        update(checked);
        return;
      }
      if (!event.isTrusted || document.visibilityState === "hidden") return;
      if (event.type === "pointermove" && Date.now() - lastPointerMove < 1000) return;
      if (event.type === "pointermove") lastPointerMove = Date.now();
      update(policy.activity());
    };
    const storage = (event: StorageEvent) => { if (event.key === sessionKey || event.key === null) check(); };
    const events = ["pointerdown", "pointermove", "click", "submit", "keydown", "touchstart", "wheel"] as const;
    for (const event of events) window.addEventListener(event, activity, { capture: true, passive: false });
    window.addEventListener("storage", storage);
    window.addEventListener("focus", check);
    window.addEventListener("pageshow", check);
    document.addEventListener("visibilitychange", check);
    const timer = window.setInterval(check, 1000);
    check();
    return () => {
      mounted = false;
      active.current = false;
      controller.current = null;
      window.clearInterval(timer);
      for (const event of events) window.removeEventListener(event, activity, true);
      window.removeEventListener("storage", storage);
      window.removeEventListener("focus", check);
      window.removeEventListener("pageshow", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [sessionKey]);

  if (!status || status.expired) return <main ref={lockedScreen} className="grid min-h-dvh place-items-center p-6">
    <div role="status" className="max-w-md text-center">
      <h1 className="text-xl font-semibold">{status?.expired ? "Session expired" : "Checking session…"}</h1>
      {status?.expired && <p className="mt-2">You were inactive for 10 minutes. Please sign in again. Unsaved changes may not have been saved.</p>}
      {failed && <button className="mt-4 rounded border px-4 py-2" onClick={() => {
        setFailed(false);
        void expire.current().catch(() => setFailed(true));
      }}>Retry sign out</button>}
    </div>
  </main>;

  return <>{children}{status.remainingMs <= IDLE_WARNING_MS && <aside role="alert" className="fixed bottom-4 left-4 right-4 z-[100] rounded-xl border border-amber-500 bg-white p-4 text-black shadow-xl sm:left-auto sm:max-w-md">
    <h2 className="font-semibold">You’ll be signed out in {Math.ceil(status.remainingMs / 1000)} seconds</h2>
    <p className="mt-1 text-sm">Save unfinished work now. Background updates do not keep your session active.</p>
    <button className="mt-3 rounded border px-3 py-2 font-medium" onClick={() => {
      const next = controller.current?.activity();
      if (next) setStatus(next);
      // The trusted pointer/keyboard event above handles normal interaction;
      // always let the expiry check run before extending the deadline.
    }}>Stay signed in</button>
  </aside>}</>;
}

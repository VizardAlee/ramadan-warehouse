"use client";

import { Bell, CheckCheck, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useNotifications } from "./use-notifications";

export function NotificationMenu() {
  const { rows, loading, error, unreadCount, markRead, clearAll } = useNotifications();
  const [open, setOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const recent = rows.filter((item) => !item.readAt).slice(0, 6);

  useEffect(() => {
    if (!open) return;
    const dismissOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const dismissEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("keydown", dismissEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("keydown", dismissEscape);
    };
  }, [open]);

  const clear = async () => {
    setClearing(true);
    setActionError(null);
    try {
      await clearAll();
    } catch {
      setActionError("Could not clear notifications. Please try again.");
    } finally {
      setClearing(false);
    }
  };

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        title="Notifications"
        aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`}
        aria-expanded={open}
        aria-controls="notification-menu"
        onClick={() => { setOpen((value) => !value); setActionError(null); }}
        className="relative inline-flex size-10 items-center justify-center rounded-lg text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
      >
        <Bell className="size-5" />
        {unreadCount > 0 && <span className="absolute -right-0.5 -top-0.5 grid min-h-5 min-w-5 place-items-center rounded-full bg-[var(--accent)] px-1 text-[10px] font-bold text-slate-900">{unreadCount > 9 ? "9+" : unreadCount}</span>}
      </button>
      {open && (
        <section
          id="notification-menu"
          aria-label="Notifications"
          className="fixed inset-x-3 top-[4.25rem] z-50 flex max-h-[calc(100dvh-5rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-[min(24rem,calc(100vw-2rem))] sm:max-h-[min(32rem,calc(100dvh-5rem))]"
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-3">
            <div>
              <h2 className="font-semibold text-slate-900">Notifications</h2>
              <p className="text-xs text-[var(--muted)]">{unreadCount} unread</p>
            </div>
            {unreadCount > 0 && (
              <button type="button" disabled={clearing} onClick={() => void clear()} className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-[var(--brand)] hover:bg-slate-50 disabled:opacity-50">
                <CheckCheck className="size-4" /> {clearing ? "Clearing…" : "Clear all"}
              </button>
            )}
          </div>
          {(error || actionError) && <p role="alert" className="mx-3 mt-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">{actionError ?? error}</p>}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {loading ? <p className="p-5 text-center text-sm text-[var(--muted)]">Loading notifications…</p> : recent.length === 0 ? (
              <p className="p-6 text-center text-sm text-[var(--muted)]">You’re all caught up.</p>
            ) : recent.map((item) => {
              const occurred = item.occurredAt?.toDate?.();
              return (
                <div key={item.id} className="border-b border-slate-100 px-4 py-3 last:border-b-0">
                  <Link
                    href={item.href}
                    onClick={() => {
                      setOpen(false);
                      void markRead(item.id).catch(() => setActionError("Could not mark the notification as read."));
                    }}
                    className="group block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
                  >
                    <span className="flex items-start justify-between gap-2 text-sm font-semibold text-slate-900 group-hover:text-[var(--brand)]">
                      {item.title}<ChevronRight className="mt-0.5 size-4 shrink-0" />
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-[var(--muted)]">{item.body}</span>
                  </Link>
                  <div className="mt-2 flex items-center justify-between gap-2 text-xs text-[var(--muted)]">
                    <span>{occurred ? occurred.toLocaleString("en-NG") : "New"}{item.actionRequired ? " · Action needed" : ""}</span>
                    <button type="button" onClick={() => void markRead(item.id).catch(() => setActionError("Could not mark the notification as read."))} className="shrink-0 rounded-md px-1 py-1 font-semibold text-[var(--brand)] hover:underline">Mark as read</button>
                  </div>
                </div>
              );
            })}
          </div>
          <Link href="/notifications" onClick={() => setOpen(false)} className="flex min-h-11 shrink-0 items-center justify-center border-t text-sm font-semibold text-[var(--brand)] hover:bg-slate-50">View notification history</Link>
        </section>
      )}
    </div>
  );
}

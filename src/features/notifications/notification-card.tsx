"use client";

import { ArrowRight, BellRing, Check } from "lucide-react";
import Link from "next/link";
import type { UserNotification } from "./use-notifications";

export function NotificationCard({
  item,
  onRead,
}: {
  item: UserNotification;
  onRead: (id: string) => Promise<void>;
}) {
  const occurred = item.occurredAt?.toDate?.();
  return (
    <article className={`rounded-xl border p-4 ${item.readAt ? "bg-white" : "border-indigo-200 bg-indigo-50/50"}`}>
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white text-[var(--brand)]">
          <BellRing className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{item.title}</h3>
            {item.actionRequired && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">Action needed</span>}
          </div>
          <p className="mt-1 text-sm text-[var(--muted)]">{item.body}</p>
          {occurred && <p className="mt-2 text-xs text-[var(--muted)]">{occurred.toLocaleString("en-NG")}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Link href={item.href} onClick={() => { if (!item.readAt) void onRead(item.id); }} className="inline-flex min-h-10 items-center gap-1 font-semibold text-[var(--brand)]">
              Open task <ArrowRight className="size-4" />
            </Link>
            {!item.readAt && <button type="button" onClick={() => void onRead(item.id)} className="inline-flex min-h-10 items-center gap-1 text-sm text-slate-600 hover:underline">
              <Check className="size-4" /> Mark read
            </button>}
          </div>
        </div>
      </div>
    </article>
  );
}

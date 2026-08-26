"use client";

import { Check, Store, Warehouse } from "lucide-react";
import { useOperatingContextOptions } from "@/features/auth/use-operating-context-options";

export function DashboardLocationSwitcher() {
  const { options, activeValue, selectValue } = useOperatingContextOptions();
  if (options.length < 2) return null;

  return (
    <section
      aria-labelledby="working-location-title"
      className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6"
    >
      <div>
        <p className="text-xs font-semibold uppercase tracking-[.14em] text-[var(--brand)]">
          Working location
        </p>
        <h2 id="working-location-title" className="mt-1 text-xl font-semibold">
          Switch branch or warehouse
        </h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--muted)]">
          The dashboard, queues, and permitted actions update to the selected
          assignment. You can only choose locations granted to your user.
        </p>
      </div>
      <div
        role="radiogroup"
        aria-label="Choose working location"
        className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
      >
        {options.map((option) => {
          const selected = option.value === activeValue;
          const Icon = option.type === "warehouse" ? Warehouse : Store;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => selectValue(option.value)}
              className={`flex min-h-20 items-center gap-3 rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${
                selected
                  ? "border-emerald-500 bg-emerald-50 text-emerald-950"
                  : "bg-white hover:border-emerald-300 hover:bg-emerald-50/40"
              }`}
            >
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-white text-[var(--brand)] shadow-sm">
                <Icon className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                  {option.typeLabel}
                </span>
                <span className="mt-1 block truncate font-semibold">
                  {option.name}
                </span>
              </span>
              {selected && (
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--brand)] text-white">
                  <Check className="size-4" />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

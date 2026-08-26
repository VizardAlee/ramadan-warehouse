import { ArrowRight, BookOpenCheck } from "lucide-react";
import Link from "next/link";
import type { WorkflowStep } from "./workflows";

const transferStepSummary = [
  "Reserve",
  "Pick & verify",
  "Pack & verify",
  "Dispatch",
  "Receive",
  "Close",
] as const;

export function WorkflowTrack({
  title,
  description,
  steps,
}: {
  title: string;
  description: string;
  steps: readonly WorkflowStep[];
}) {
  return (
    <section className="rounded-xl border bg-white p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-[var(--brand)]">
          <BookOpenCheck className="size-5" />
        </span>
        <div>
          <h2 className="section-title">{title}</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--muted)]">
            {description}
          </p>
        </div>
      </div>
      <ol className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {steps.map((step, index) => (
          <li
            key={step.title}
            className="relative min-w-0 rounded-xl border bg-[#f8fbf9] p-4"
          >
            <div className="flex items-center gap-2">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--brand)] text-xs font-semibold text-white">
                {index + 1}
              </span>
              <h3 className="font-semibold">{step.title}</h3>
            </div>
            <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
              {step.detail}
            </p>
            {step.href && (
              <Link
                href={step.href}
                className="mt-3 inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-[var(--brand)]"
              >
                Open this step <ArrowRight className="size-4" />
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function TransferQuickGuide() {
  return (
    <aside
      className="rounded-xl border border-emerald-200 bg-emerald-50 p-5"
      aria-labelledby="transfer-quick-guide-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.14em] text-emerald-800">
            First-time guide
          </p>
          <h2
            id="transfer-quick-guide-title"
            className="mt-1 text-lg font-semibold text-emerald-950"
          >
            Reserved stock goes to picking next
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-emerald-900">
            Reservation only locks the stock. Warehouse staff must still pick
            it, verify it, pack it, dispatch it, and the destination must
            receive it.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/transfers/picking"
            className="inline-flex min-h-11 items-center rounded-lg bg-[var(--brand)] px-4 text-sm font-semibold text-white"
          >
            Open Picking queue
          </Link>
          <Link
            href="/guide#transfers"
            className="inline-flex min-h-11 items-center rounded-lg border border-emerald-300 bg-white px-4 text-sm font-semibold text-[var(--brand)]"
          >
            Full visual guide
          </Link>
        </div>
      </div>
      <ol className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {transferStepSummary.map((step, index) => (
          <li
            key={step}
            className={`rounded-lg border px-3 py-3 text-center text-xs font-semibold ${index === 1 ? "border-emerald-500 bg-white text-[var(--brand-dark)]" : "border-emerald-200 bg-emerald-100/60 text-emerald-950"}`}
          >
            <span className="mx-auto mb-1 grid size-6 place-items-center rounded-full bg-white/80 tabular-nums">
              {index + 1}
            </span>
            {step}
          </li>
        ))}
      </ol>
    </aside>
  );
}

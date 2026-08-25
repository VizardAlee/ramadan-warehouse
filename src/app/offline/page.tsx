import { Boxes, CloudOff, ShoppingCart } from "lucide-react";
import Link from "next/link";

export default function OfflinePage() {
  return <main className="grid min-h-dvh place-items-center px-[var(--page-gutter)] py-10 text-center">
    <section className="w-full max-w-lg rounded-2xl border bg-white p-[clamp(1.5rem,5vw,2.5rem)] shadow-sm">
      <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-emerald-50 text-[var(--brand)]"><CloudOff className="size-7" /></span>
      <p className="mt-5 text-xs font-semibold uppercase tracking-[.16em] text-[var(--brand)]">AB Ramadan Warehouse</p>
      <h1 className="mt-2 text-3xl font-semibold">You&apos;re offline</h1>
      <p className="mt-3 leading-7 text-[var(--muted)]">This screen is not available without the internet. Reconnect and try again. If this device previously opened the POS online, branch sales can continue from its trusted offline catalogue.</p>
      <div className="mt-7 grid gap-3 sm:grid-cols-2">
        <Link href="/pos" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-[var(--brand)] px-4 font-semibold text-white"><ShoppingCart className="size-5" /> Open offline POS</Link>
        <Link href="/dashboard" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border bg-white px-4 font-semibold"><Boxes className="size-5" /> Try dashboard</Link>
      </div>
    </section>
  </main>;
}

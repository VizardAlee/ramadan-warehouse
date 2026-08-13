import { Boxes, ShieldCheck } from "lucide-react";
import { LoginForm } from "@/features/auth/login-form";

export default function LoginPage() {
  return <main className="grid min-h-dvh lg:grid-cols-[minmax(0,1.05fr)_minmax(24rem,.95fr)]">
    <section className="hidden bg-[var(--brand-dark)] p-[clamp(2.5rem,5vw,5rem)] text-white lg:flex lg:flex-col lg:justify-between">
      <div className="flex items-center gap-3 text-lg font-semibold"><span className="grid size-10 place-items-center rounded-xl bg-white/10"><Boxes /></span>AB Ramadan Warehouse</div>
      <div><p className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-amber-300">Central warehouse control</p><h1 className="max-w-xl text-[clamp(2.5rem,4vw,4rem)] font-semibold leading-[1.08]">Accountable stock movement, from warehouse to branch.</h1><p className="mt-6 max-w-lg text-lg text-emerald-100">Secure transfers, traceable approvals, and a permanent operational audit trail.</p></div>
      <p className="flex items-center gap-2 text-sm text-emerald-100"><ShieldCheck className="size-4"/>Protected with Firebase Authentication and least-privilege access</p>
    </section>
    <section className="safe-bottom flex items-center justify-center p-[clamp(1rem,5vw,3rem)]"><div className="w-full max-w-md rounded-2xl border bg-white p-[clamp(1.25rem,5vw,2rem)] shadow-sm"><div className="mb-7 flex items-center gap-3 lg:hidden"><span className="grid size-10 place-items-center rounded-xl bg-emerald-50 text-[var(--brand)]"><Boxes /></span><span className="font-semibold">AB Ramadan Warehouse</span></div><p className="text-xs font-bold tracking-[.12em] text-[var(--brand)]">SECURE WAREHOUSE PORTAL</p><h2 className="mt-2 text-[clamp(1.75rem,6vw,2.25rem)] font-semibold">Welcome back</h2><p className="mb-8 mt-2 text-sm leading-6 text-[var(--muted)]">Sign in with the account provisioned by your administrator.</p><LoginForm /></div></section>
  </main>;
}

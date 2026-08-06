import { Boxes, ShieldCheck } from "lucide-react";
import { LoginForm } from "@/features/auth/login-form";

export default function LoginPage() {
  return <main className="grid min-h-screen lg:grid-cols-[1.05fr_0.95fr]">
    <section className="hidden bg-[var(--brand-dark)] p-14 text-white lg:flex lg:flex-col lg:justify-between">
      <div className="flex items-center gap-3 text-lg font-semibold"><span className="grid size-10 place-items-center rounded-xl bg-white/10"><Boxes /></span>Solar Operations</div>
      <div><p className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-amber-300">Central warehouse control</p><h1 className="max-w-xl text-5xl font-semibold leading-tight">Accountable stock movement, from warehouse to branch.</h1><p className="mt-6 max-w-lg text-lg text-emerald-100">Secure transfers, traceable approvals, and a permanent operational audit trail.</p></div>
      <p className="flex items-center gap-2 text-sm text-emerald-100"><ShieldCheck className="size-4"/>Protected with Firebase Authentication and least-privilege access</p>
    </section>
    <section className="flex items-center justify-center p-6"><div className="w-full max-w-md rounded-2xl border bg-white p-8 shadow-sm"><p className="text-sm font-semibold text-[var(--brand)]">WAREHOUSE PORTAL</p><h2 className="mt-2 text-3xl font-semibold">Welcome back</h2><p className="mb-8 mt-2 text-sm text-[var(--muted)]">Use the account provisioned by your administrator.</p><LoginForm /></div></section>
  </main>;
}

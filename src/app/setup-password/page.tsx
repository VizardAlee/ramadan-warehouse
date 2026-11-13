import { Suspense } from "react";
import type { Metadata } from "next";
import { PasswordSetup } from "@/features/auth/password-setup";

export const metadata: Metadata = { title: "Set your password", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default function PasswordSetupPage() {
  return <main className="min-h-screen bg-slate-50 px-4 py-16"><section className="mx-auto max-w-md rounded-2xl border bg-white p-6 shadow-sm"><p className="text-sm font-semibold text-slate-600">AB Ramadan</p><h1 className="my-3 text-2xl font-bold">Set your password</h1><Suspense fallback={<p role="status">Checking your setup link…</p>}><PasswordSetup /></Suspense></section></main>;
}

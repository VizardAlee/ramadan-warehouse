"use client";

import { Archive, Boxes, ClipboardList, FileBarChart, Gauge, History, LogOut, Menu, PackageCheck, ReceiptText, RefreshCw, Settings, ShieldCheck, Truck, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth/auth-context";
import { cn } from "@/lib/utils";
import { useConnectivity } from "@/lib/connectivity";

const navigation = [
  ["/dashboard", "Dashboard", Gauge], ["/products", "Products", Boxes], ["/inventory", "Inventory", Archive], ["/requests", "Requests", ClipboardList],
  ["/transfers", "Transfers", Truck], ["/costs", "Costs", ReceiptText], ["/reports", "Reports", FileBarChart], ["/administration", "Administration", Settings], ["/audit", "Audit", History],
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { user, profile, loading, error, logout, refreshAuthorization } = useAuth(); const pathname = usePathname(); const router = useRouter(); const [open, setOpen] = useState(false);
  const { online } = useConnectivity();
  useEffect(() => { if (!loading && !user) router.replace("/login"); }, [loading, user, router]);
  if (loading) return <main className="grid min-h-screen place-items-center"><div className="text-center"><PackageCheck className="mx-auto mb-3 size-9 animate-pulse text-[var(--brand)]"/><p className="text-sm text-[var(--muted)]">Verifying warehouse access…</p></div></main>;
  if (!user) return null;
  if (!profile) return <main className="grid min-h-screen place-items-center p-6"><div className="max-w-md rounded-xl border bg-white p-8 text-center"><ShieldCheck className="mx-auto mb-4 size-10 text-red-700"/><h1 className="text-xl font-semibold">Access is not provisioned</h1><p className="mt-2 text-sm text-[var(--muted)]">{error ?? "Ask a system administrator to create your active user profile."}</p><Button className="mt-6" variant="secondary" onClick={() => void logout()}>Sign out</Button></div></main>;
  return <div className="min-h-screen lg:grid lg:grid-cols-[260px_1fr]">
    <aside className={cn("fixed inset-y-0 left-0 z-40 w-[280px] bg-[#10291f] p-5 text-white transition-transform lg:static lg:w-auto lg:translate-x-0", open ? "translate-x-0" : "-translate-x-full")}>
      <div className="mb-8 flex items-center justify-between"><Link href="/dashboard" className="flex items-center gap-3 font-semibold"><span className="grid size-10 place-items-center rounded-xl bg-amber-400 text-[#10291f]"><Boxes/></span><span>Solar Warehouse<small className="block text-xs font-normal text-emerald-200">Operations control</small></span></Link><button className="lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu"><X/></button></div>
      <nav className="space-y-1">{navigation.map(([href, label, Icon]) => <Link key={href} href={href} onClick={() => setOpen(false)} className={cn("flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-emerald-50 transition hover:bg-white/10", pathname === href && "bg-white/15 font-semibold text-white")}><Icon className="size-4"/>{label}</Link>)}</nav>
    </aside>
    {open && <button className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setOpen(false)} aria-label="Close navigation overlay"/>}
    <div className="min-w-0"><header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b bg-white/95 px-4 backdrop-blur md:px-8"><button className="lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu/></button><div className="ml-auto flex items-center gap-2"><Button variant="ghost" title="Refresh authorization" onClick={() => void refreshAuthorization()}><RefreshCw className="size-4"/><span className="sr-only">Refresh authorization</span></Button><div className="hidden text-right sm:block"><p className="text-sm font-semibold">{profile.displayName}</p><p className="text-xs text-[var(--muted)]">{profile.roleId.replaceAll("_", " ")}</p></div><Button variant="ghost" onClick={() => void logout().then(() => router.replace("/login"))}><LogOut className="mr-2 size-4"/>Sign out</Button></div></header>{!online && <div role="status" className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-sm text-amber-950">You are offline. Displayed data may be stale; reservation, dispatch, receipt, discrepancy, and closure actions require reconnection.</div>}<main className="p-4 md:p-8">{children}</main></div>
  </div>;
}

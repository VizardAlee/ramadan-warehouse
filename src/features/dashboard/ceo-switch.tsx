"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/features/auth/auth-context";
import { canReadCeoView } from "./ceo-directory";

export function CeoViewSwitch() {
  const { profile } = useAuth(), pathname = usePathname();
  const [href, setHref] = useState("/dashboard/ceo");
  useEffect(() => {
    let saved: string | null = null;
    try { saved = window.sessionStorage.getItem(`warehouse-ceo-view:${profile?.organizationId}:${profile?.uid}`); } catch { /* Optional convenience only. */ }
    if (saved?.startsWith("/dashboard/ceo?")) queueMicrotask(() => setHref(saved!));
  }, [pathname, profile?.organizationId, profile?.uid]);
  if (!canReadCeoView(profile)) return null;
  const active = pathname === "/dashboard/ceo";
  return <Link href={active ? "/dashboard" : href} aria-label={active ? "Usual dashboard" : "CEO view"} className="inline-flex min-h-10 shrink-0 items-center whitespace-nowrap rounded-lg border border-teal-700/20 bg-teal-50 px-2 text-xs font-semibold text-teal-900 sm:px-3">{active ? <><span className="sm:hidden">Dashboard</span><span className="hidden sm:inline">Usual dashboard</span></> : "CEO view"}</Link>;
}

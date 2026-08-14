"use client";

import Link from "next/link";
import { useAuth } from "@/features/auth/auth-context";
import { hasAnyPermission } from "@/lib/permissions/roles";
import type { PermissionId } from "@/types/domain";

export interface PermissionTab {
  readonly href: string;
  readonly label: string;
  readonly permissions: readonly PermissionId[];
}

export function PermissionTabs({
  label,
  tabs,
}: {
  label: string;
  tabs: readonly PermissionTab[];
}) {
  const { profile } = useAuth();
  if (!profile) return null;
  const visibleTabs = tabs.filter((tab) =>
    hasAnyPermission(profile, tab.permissions),
  );
  if (visibleTabs.length < 2) return null;
  return (
    <nav
      aria-label={label}
      className="scroll-tabs rounded-xl border bg-white p-2"
    >
      {visibleTabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className="inline-flex min-h-11 items-center whitespace-nowrap rounded-lg px-3 text-sm font-medium hover:bg-emerald-50 hover:text-[var(--brand)]"
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

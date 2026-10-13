"use client";
import Link from "next/link";
import { Children, createContext, isValidElement, useContext, type ReactNode } from "react";
import { hasPermission } from "@/lib/permissions/roles";
import type { UserProfile } from "@/types/domain";
import { actionPrerequisites, type ActionPrerequisite } from "./action-prerequisites";
export const ActionGuidanceContext = createContext<{ pathname: string; profile: UserProfile | null } | null>(null);
export function ActionGuidanceProvider({ pathname, profile, children }: { pathname: string; profile: UserProfile | null; children: ReactNode }) {
  return <ActionGuidanceContext.Provider value={{ pathname, profile }}>{children}</ActionGuidanceContext.Provider>;
}
export function buttonText(children: ReactNode): string {
  return Children.toArray(children).map(child => typeof child === "string" || typeof child === "number" ? String(child) :
    isValidElement<{children?: ReactNode}>(child) ? buttonText(child.props.children) : "").join(" ");
}
export function buttonIsBusy(children: ReactNode): boolean {
  return Children.toArray(children).some(child => isValidElement<{children?: ReactNode; className?: string; "aria-busy"?: boolean}>(child) &&
    (child.props["aria-busy"] === true || /(?:^|\s)animate-spin(?:\s|$)/.test(child.props.className ?? "") || buttonIsBusy(child.props.children)));
}
export function PrerequisiteText({ rule }: { rule: ActionPrerequisite }) {
  const context = useContext(ActionGuidanceContext), profile = context?.profile;
  const allowed = Boolean(rule.href && profile && rule.permissions?.every(permission => hasPermission(profile, permission)));
  return <>{rule.instruction} <span className="block mt-1">{rule.resolver}</span>{allowed && <Link className="mt-1 inline-flex min-h-11 items-center font-semibold underline" href={rule.href!}>{rule.linkLabel}</Link>}</>;
}
export function WorkspacePrerequisites() {
  const context = useContext(ActionGuidanceContext);
  if (!context) return null;
  const rules = actionPrerequisites.filter(item => context.pathname.startsWith(item.route));
  if (!rules.length) return null;
  return <details className="mb-4 rounded-xl border bg-white p-4" data-workspace-prerequisites>
    <summary className="cursor-pointer font-semibold">Help for unavailable actions</summary>
    <p className="mt-2 text-sm text-[var(--muted)]">An unavailable action keeps its business and access checks. Review the requirements below; if the task needs another role, ask the responsible person. After an approved access change, use Refresh authorization. Loading and first/last-page controls may simply need no further action.</p>
    <ul className="mt-3 grid gap-3 text-sm lg:grid-cols-2">{rules.map((rule,index)=><li key={index} className="min-w-0 rounded-lg border p-3"><strong className="block mb-1">{rule.actions.join(" / ")}</strong><PrerequisiteText rule={rule}/></li>)}</ul>
  </details>;
}


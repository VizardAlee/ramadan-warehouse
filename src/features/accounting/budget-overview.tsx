"use client";

import { useState } from "react";
import { BudgetWorkspace } from "./budget-workspace";

/** Company and branch targets remain separate, so overlapping budgets are never summed. */
export function BudgetOverview({ ownerKey, branchId, canManage, organizationRead, branches }: { ownerKey: string; branchId?: string; canManage: boolean; organizationRead: boolean; branches: Array<{ id: string; name: string }> }) {
  const [expanded, setExpanded] = useState<string[]>([]);
  if (branchId) return <BudgetWorkspace ownerKey={ownerKey} branchId={branchId} canManage={canManage} />;
  return <section className="space-y-4" aria-label="Budgets across authorized locations">
    <h2 className="text-xl font-semibold">Budgets across locations</h2>
    <p className="text-sm text-[var(--muted)]">Company targets and individual branch targets are reviewed separately. Choose a working branch to change its budget.</p>
    {organizationRead && <section aria-label="Shared company budget"><h3 className="font-semibold">Shared company targets</h3><BudgetWorkspace ownerKey={ownerKey} canManage={canManage} /></section>}
    {branches.map(branch => <details key={branch.id} className="surface p-4" onToggle={event => { const open = event.currentTarget.open; setExpanded(current => open ? [...new Set([...current, branch.id])] : current.filter(id => id !== branch.id)); }}>
      <summary className="cursor-pointer py-2 font-semibold">{branch.name} budgets</summary>
      {expanded.includes(branch.id) && <BudgetWorkspace ownerKey={`${ownerKey}:${branch.id}`} branchId={branch.id} canManage={false} />}
    </details>)}
  </section>;
}

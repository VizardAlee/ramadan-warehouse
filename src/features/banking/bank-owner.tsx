"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import type { BankAccount } from "@/types/domain";
export function BankOwner({ account, branches, onSaved }: { account: BankAccount; branches: Array<{ id: string; name: string }>; onSaved: () => void }) {
  const [branchId, setBranch] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState<string>();
  if (account.branchId) return <p className="text-sm">Owned by {branches.find(row => row.id === account.branchId)?.name ?? account.branchId}. Ownership is fixed; use a separate account and authorized company transfer to move funds.</p>;
  async function save() {
    if (!branchId || busy) return; setBusy(true); setError(undefined);
    try { await callAdministration("saveBankAccount", { bankAccountId: account.id, bankName: account.bankName, accountName: account.accountName, accountNumberLast4: account.accountNumberLast4, ledgerAccountCode: account.ledgerAccountCode, openingBalanceMinor: account.openingBalanceMinor, openingDate: account.openingDate, active: account.active, branchId }); onSaved(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Account owner could not be saved."); } finally { setBusy(false); }
  }
  return <section className="mt-3 space-y-3 rounded-lg border p-3"><p className="text-sm">This existing account is company-wide / unassigned. Assigning an owner restricts future payments to that store; historical journals are preserved. Ownership cannot be reassigned later.</p><label className="block text-sm">Assign bank account owner<select className="input mt-1 block w-full" disabled={busy} value={branchId} onChange={event => setBranch(event.target.value)}><option value="">Choose store</option>{branches.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>{error && <p role="alert">{error}</p>}<Button variant="outline" disabled={busy || !branchId} onClick={() => void save()}>Save bank account owner</Button></section>;
}

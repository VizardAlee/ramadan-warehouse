"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import type { BankAccount } from "@/types/domain";

export function BankAccountDetails({ account, canManage, disabled = false, allLocations = true, onSaved }: {
  account: BankAccount;
  canManage: boolean;
  disabled?: boolean;
  allLocations?: boolean;
  onSaved: (updated?: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ bankName: account.bankName, accountName: account.accountName, accountNumberLast4: account.accountNumberLast4 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const submitting = useRef(false);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  if (!canManage || !account.active || (account.lifecycleStatus && account.lifecycleStatus !== "active")) return null;
  const changed = form.bankName.trim() !== account.bankName || form.accountName.trim() !== account.accountName || form.accountNumberLast4 !== account.accountNumberLast4;
  const valid = form.bankName.trim().length >= 2 && form.bankName.trim().length <= 120 && form.accountName.trim().length >= 2 && form.accountName.trim().length <= 160 && /^\d{4}$/.test(form.accountNumberLast4);
  const blocked = disabled || busy || !allLocations || needsRefresh;
  function reset() {
    setForm({ bankName: account.bankName, accountName: account.accountName, accountNumberLast4: account.accountNumberLast4 });
    setError(undefined); setMessage(undefined);
  }
  async function save() {
    if (blocked || submitting.current || !valid || !changed) return;
    submitting.current = true; setBusy(true); setError(undefined); setMessage(undefined);
    try {
      await callAdministration("saveBankAccount", {
        bankAccountId: account.id,
        bankName: form.bankName.trim(), accountName: form.accountName.trim(), accountNumberLast4: form.accountNumberLast4,
        ledgerAccountCode: account.ledgerAccountCode,
        openingBalanceMinor: account.openingBalanceMinor, openingDate: account.openingDate,
        // Keep lifecycle unchanged. Omit branchId so the server preserves ownership.
        active: account.active,
      });
      if (!live.current) return;
      setEditing(false); setMessage("Bank details updated. Ledger, opening reference and transaction history are unchanged.");
      onSaved(true);
    } catch (cause) {
      if (!live.current) return;
      setError(`${cause instanceof Error ? cause.message : "Bank details could not be saved."} Refresh the account and check its details before trying again.`);
      setNeedsRefresh(true);
    } finally { submitting.current = false; if (live.current) setBusy(false); }
  }
  return <section className="space-y-3 rounded-xl border bg-white p-5">
    <h2 className="text-lg font-semibold">Bank account details</h2>
    <p className="text-sm text-[var(--muted)]">Correct the details of this existing account only. This does not replace the account, move money, change its owner or opening reference, or rewrite transactions. Use Add bank account for a different real account.</p>
    {!allLocations && <p role="status" className="text-sm">Select All locations in Working location to edit bank details.</p>}
    {message && <p role="status" className="text-sm text-emerald-800">{message}</p>}
    {!editing ? <Button variant="outline" disabled={blocked} onClick={() => { reset(); setEditing(true); }}>Edit bank details</Button> : <form className="space-y-3" onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset disabled={blocked} className="grid gap-3 md:grid-cols-3">
        <label className="text-sm">Bank name<input className="mt-1 w-full rounded-lg border p-3" required minLength={2} maxLength={120} value={form.bankName} onChange={event => setForm({ ...form, bankName: event.target.value })} /></label>
        <label className="text-sm">Account name<input className="mt-1 w-full rounded-lg border p-3" required minLength={2} maxLength={160} value={form.accountName} onChange={event => setForm({ ...form, accountName: event.target.value })} /></label>
        <label className="text-sm">Account number — last 4 digits<input className="mt-1 w-full rounded-lg border p-3" required inputMode="numeric" maxLength={4} pattern="[0-9]{4}" value={form.accountNumberLast4} onChange={event => setForm({ ...form, accountNumberLast4: event.target.value.replace(/\D/g, "") })} /></label>
      </fieldset>
      <p className="text-sm">Ledger {account.ledgerAccountCode} and its recorded balance will be retained.</p>
      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
      <div className="flex flex-wrap gap-2"><Button type="submit" disabled={blocked || !valid || !changed}>{busy ? "Saving bank details…" : "Save bank details"}</Button><Button type="button" variant="outline" disabled={busy} onClick={() => { reset(); setEditing(false); }}>Cancel</Button>
      {needsRefresh && <Button type="button" variant="outline" disabled={busy} onClick={() => onSaved()}>Refresh account details</Button>}</div>
    </form>}
  </section>;
}

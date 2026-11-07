"use client";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { AppDialog } from "@/components/ui/app-dialog";
import { FinancialMessage, FinancialText } from "@/features/finance/financial-privacy";
import { callAdministration } from "@/features/administration/api";
import type { Customer } from "@/types/domain";

export function CustomerStatusAction({ customer, onSaved }: { customer: Customer; onSaved: () => void }) {
  const [open, setOpen] = useState(false), [number, setNumber] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState(""), [uncertain, setUncertain] = useState(false);
  const pending = useRef<Record<string, unknown> | null>(null), inFlight = useRef(false);
  const blocked = customer.active && (customer.outstandingBalanceMinor > 0 || Object.values(customer.advanceBalances ?? {}).some(amount => amount > 0));
  const label = customer.active ? "Deactivate" : "Reactivate";
  async function save() {
    if (inFlight.current || (!uncertain && (blocked || number !== customer.customerNumber))) return;
    pending.current ??= { action: "set_status", customerId: customer.id, active: !customer.active, confirmedCustomerNumber: number, idempotencyKey: crypto.randomUUID() };
    inFlight.current = true; setBusy(true); setError("");
    try { await callAdministration("saveCustomer", pending.current); pending.current = null; setUncertain(false); setOpen(false); onSaved(); }
    catch (cause) {
      const code = (cause as { diagnosticCode?: string; code?: string }).diagnosticCode ?? (cause as { code?: string }).code ?? "";
      const definitive = ["functions/invalid-argument", "functions/failed-precondition", "functions/permission-denied", "functions/not-found", "functions/already-exists"].includes(code);
      if (definitive) pending.current = null;
      setUncertain(!definitive); setError(cause instanceof Error ? cause.message : "Customer status could not be confirmed.");
    } finally { inFlight.current = false; setBusy(false); }
  }
  return <>
    <Button size="sm" variant="outline" onClick={() => { setOpen(true); if (!uncertain) { setNumber(""); setError(""); } }}>{label}</Button>
    {open && <AppDialog role="dialog" aria-modal="true" aria-label={`${label} customer`}><section className="app-dialog-panel max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-2xl">
      <h2 className="text-xl font-semibold"><FinancialText>{label} {customer.name}?</FinancialText></h2>
      <p className="text-sm">{customer.active ? "This removes the customer from new-sale selection. You can reactivate them later." : "This makes the customer available for new sales again."} Invoices, payments, balances and history remain unchanged. Nothing is permanently deleted.</p>
      {blocked && <p role="alert" className="text-sm text-red-700">Settle outstanding debt and unused advances before deactivating this customer.</p>}
      <label className="block text-sm">Confirm customer number (<FinancialText>{customer.customerNumber}</FinancialText>)<input disabled={busy || uncertain} className="mt-1 w-full rounded-lg border p-3" value={number} onChange={event => setNumber(event.target.value)} autoComplete="off" /></label>
      {error && <p role="alert" className="text-sm text-red-700"><FinancialMessage>{error}</FinancialMessage></p>}
      {uncertain && <p className="text-sm">The result is not confirmed. Retry the same change to check it safely.</p>}
      <div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={() => { setOpen(false); if (!uncertain) pending.current = null; }}>Close</Button><Button disabled={busy || (!uncertain && (blocked || number !== customer.customerNumber))} onClick={() => void save()}>{busy ? "Saving…" : uncertain ? "Retry same change" : `${label} customer`}</Button></div>
    </section></AppDialog>}
  </>;
}

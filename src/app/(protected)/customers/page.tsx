"use client";

import { BadgeCheck, CreditCard, Plus, RefreshCw, UserRound } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import { useOrganizationCollection } from "@/features/administration/use-organization-collection";
import { useAuth } from "@/features/auth/auth-context";
import { formatNaira, nairaToKobo } from "@/features/inventory/format";
import { hasPermission } from "@/lib/permissions/roles";
import type { Branch, Customer } from "@/types/domain";

type CustomerAction = "create" | "edit" | "credit" | "payment";

const emptyForm = {
  name: "",
  phone: "",
  email: "",
  address: "",
  taxId: "",
  active: true,
};

export default function CustomersPage() {
  const { profile, accessProfile, operatingContext } = useAuth();
  const customers = useOrganizationCollection<Customer>("customers");
  const branches = useOrganizationCollection<Branch>("branches");
  const [action, setAction] = useState<CustomerAction | null>(null);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [creditLimit, setCreditLimit] = useState("");
  const [creditDecision, setCreditDecision] = useState<"approve" | "suspend" | "reject">("approve");
  const [reason, setReason] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card" | "bank_transfer">("cash");
  const [paymentReference, setPaymentReference] = useState("");
  const [manualBranchId, setManualBranchId] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canManage = Boolean(profile && hasPermission(profile, "customers.manage"));
  const canApprove = Boolean(profile && hasPermission(profile, "customers.credit.approve"));
  const canRecordPayment = Boolean(profile && hasPermission(profile, "customers.payment.record"));
  const contextBranchId = operatingContext?.type === "branch" ? operatingContext.id : "";
  const assignedBranchId = accessProfile?.branchIds.length === 1 ? accessProfile.branchIds[0]! : "";
  const activeBranches = branches.data.filter((branch) => branch.status === "active");
  const branchId = contextBranchId || assignedBranchId || manualBranchId || activeBranches[0]?.id || "";
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return customers.data.filter((customer) =>
      !term || `${customer.name} ${customer.customerNumber} ${customer.phone ?? ""} ${customer.email ?? ""}`.toLowerCase().includes(term),
    );
  }, [customers.data, search]);

  function closeAction() {
    setAction(null);
    setSelected(null);
    setForm(emptyForm);
    setReason("");
    setCreditLimit("");
    setPaymentAmount("");
    setPaymentReference("");
  }

  function edit(customer: Customer) {
    setSelected(customer);
    setForm({
      name: customer.name,
      phone: customer.phone ?? "",
      email: customer.email ?? "",
      address: customer.address ?? "",
      taxId: customer.taxId ?? "",
      active: customer.active,
    });
    setAction("edit");
  }

  async function saveCustomer() {
    setBusy(true); setError(null); setMessage(null);
    try {
      const result = await callAdministration<Record<string, unknown>, { customerNumber: string }>("saveCustomer", {
        customerId: selected?.id,
        ...form,
        phone: form.phone || undefined,
        email: form.email || undefined,
        address: form.address || undefined,
        taxId: form.taxId || undefined,
        idempotencyKey: crypto.randomUUID(),
      });
      closeAction();
      setMessage(`${result.customerNumber} saved. Credit remains unavailable until a system administrator approves a limit.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The customer could not be saved.");
    } finally { setBusy(false); }
  }

  async function decideCredit() {
    if (!selected) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      await callAdministration("decideCustomerCredit", {
        customerId: selected.id,
        decision: creditDecision,
        creditLimitMinor: creditDecision === "approve" ? nairaToKobo(Number(creditLimit)) : 0,
        reason,
        idempotencyKey: crypto.randomUUID(),
      });
      closeAction();
      setMessage(`${selected.name}'s credit authority was ${creditDecision === "approve" ? "approved" : creditDecision === "suspend" ? "suspended" : "rejected"}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The credit decision could not be saved.");
    } finally { setBusy(false); }
  }

  async function recordPayment() {
    if (!selected || !branchId) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const result = await callAdministration<Record<string, unknown>, { paymentNumber: string }>("recordCustomerPayment", {
        customerId: selected.id,
        branchId,
        method: paymentMethod,
        amountMinor: nairaToKobo(Number(paymentAmount)),
        reference: paymentReference || undefined,
        idempotencyKey: crypto.randomUUID(),
      });
      closeAction();
      setMessage(`Payment ${result.paymentNumber} recorded and posted to Accounts Receivable.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The payment could not be recorded.");
    } finally { setBusy(false); }
  }

  if (!profile || !hasPermission(profile, "customers.read"))
    return <div className="rounded-xl border bg-white p-6">Your roles do not include customer-account access.</div>;

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-[var(--brand)]">Sales accounts</p>
          <h1 className="text-3xl font-semibold">Customers &amp; credit</h1>
          <p className="text-[var(--muted)]">Create customer records, control credit authority, and record repayments without editing posted sales.</p>
        </div>
        {canManage && <Button onClick={() => { setForm(emptyForm); setAction("create"); }}><Plus className="mr-2 size-4" /> Add customer</Button>}
      </header>
      {error && <div role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</div>}
      {message && <div role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">{message}</div>}
      <section className="rounded-xl border bg-white p-4">
        <label className="text-sm font-medium">Find customer
          <input value={search} onChange={(event) => setSearch(event.target.value)} className="mt-1 w-full rounded-lg border p-3" placeholder="Name, number, phone or email" />
        </label>
      </section>
      <section className="grid gap-4 lg:grid-cols-2">
        {visible.map((customer) => (
          <article key={customer.id} className="rounded-xl border bg-white p-5">
            <div className="flex items-start justify-between gap-3">
              <div><h2 className="font-semibold">{customer.name}</h2><p className="font-mono text-xs text-[var(--muted)]">{customer.customerNumber}</p></div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${customer.creditStatus === "approved" ? "bg-emerald-100 text-emerald-800" : customer.creditStatus === "suspended" ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-700"}`}>{customer.creditStatus}</span>
            </div>
            <p className="mt-3 text-sm text-[var(--muted)]">{customer.phone || customer.email || "No contact"}</p>
            <dl className="mt-4 grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-3 text-sm">
              <div><dt className="text-xs text-[var(--muted)]">Limit</dt><dd className="font-semibold">{formatNaira(customer.creditLimitMinor)}</dd></div>
              <div><dt className="text-xs text-[var(--muted)]">Outstanding</dt><dd className="font-semibold">{formatNaira(customer.outstandingBalanceMinor)}</dd></div>
              <div><dt className="text-xs text-[var(--muted)]">Available</dt><dd className="font-semibold">{formatNaira(customer.availableCreditMinor)}</dd></div>
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              {canManage && <Button variant="outline" onClick={() => edit(customer)}>Edit details</Button>}
              {canApprove && <Button variant="outline" onClick={() => { setSelected(customer); setCreditDecision(customer.creditStatus === "approved" ? "suspend" : "approve"); setCreditLimit(String(customer.creditLimitMinor / 100 || "")); setAction("credit"); }}><BadgeCheck className="mr-2 size-4" /> Credit decision</Button>}
              {canRecordPayment && customer.outstandingBalanceMinor > 0 && <Button onClick={() => { setSelected(customer); setPaymentAmount(String(customer.outstandingBalanceMinor / 100)); setAction("payment"); }}><CreditCard className="mr-2 size-4" /> Record payment</Button>}
            </div>
          </article>
        ))}
        {!customers.loading && visible.length === 0 && <div className="col-span-full rounded-xl border bg-white p-8 text-center text-[var(--muted)]">No customers match. Add the customer once, then let a system administrator approve credit if required.</div>}
      </section>

      {action && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Customer action">
          <section className="safe-bottom max-h-[calc(100dvh-1rem)] w-full max-w-xl overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl sm:p-6">
            <div className="flex items-center gap-3"><UserRound className="size-6 text-[var(--brand)]" /><h2 className="text-xl font-semibold">{action === "create" ? "Add customer" : action === "edit" ? "Edit customer" : action === "credit" ? "Administrator credit decision" : "Record customer payment"}</h2></div>
            {(action === "create" || action === "edit") && <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium sm:col-span-2">Customer name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="mt-1 w-full rounded-lg border p-3" /></label>
              <label className="text-sm font-medium">Phone (070 format)<input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} className="mt-1 w-full rounded-lg border p-3" placeholder="07012345678" /></label>
              <label className="text-sm font-medium">Email (optional)<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="mt-1 w-full rounded-lg border p-3" /></label>
              <label className="text-sm font-medium sm:col-span-2">Address (optional)<textarea value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} className="mt-1 w-full rounded-lg border p-3" /></label>
              <label className="text-sm font-medium">Tax ID (optional)<input value={form.taxId} onChange={(event) => setForm({ ...form, taxId: event.target.value })} className="mt-1 w-full rounded-lg border p-3" /></label>
              <label className="flex items-center gap-2 self-end pb-3 text-sm"><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} /> Active customer</label>
            </div>}
            {action === "credit" && selected && <div className="mt-5 space-y-4">
              <p className="rounded-lg bg-slate-50 p-3 text-sm"><strong>{selected.name}</strong><br />Outstanding: {formatNaira(selected.outstandingBalanceMinor)}</p>
              <label className="block text-sm font-medium">Decision<select value={creditDecision} onChange={(event) => setCreditDecision(event.target.value as typeof creditDecision)} className="mt-1 w-full rounded-lg border p-3"><option value="approve">Approve / change limit</option><option value="suspend">Suspend new credit</option><option value="reject">Reject credit</option></select></label>
              {creditDecision === "approve" && <label className="block text-sm font-medium">Credit limit (₦)<input type="number" min="0.01" step="0.01" value={creditLimit} onChange={(event) => setCreditLimit(event.target.value)} className="mt-1 w-full rounded-lg border p-3" /></label>}
              <label className="block text-sm font-medium">Decision reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 w-full rounded-lg border p-3" /></label>
            </div>}
            {action === "payment" && selected && <div className="mt-5 space-y-4">
              <p className="rounded-lg bg-slate-50 p-3 text-sm"><strong>{selected.name}</strong><br />Outstanding before payment: {formatNaira(selected.outstandingBalanceMinor)}</p>
              {!contextBranchId && !assignedBranchId && <label className="block text-sm font-medium">Receiving branch<select value={branchId} onChange={(event) => setManualBranchId(event.target.value)} className="mt-1 w-full rounded-lg border p-3">{activeBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>}
              <label className="block text-sm font-medium">Amount received (₦)<input type="number" min="0.01" step="0.01" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} className="mt-1 w-full rounded-lg border p-3" /></label>
              <label className="block text-sm font-medium">Method<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as typeof paymentMethod)} className="mt-1 w-full rounded-lg border p-3"><option value="cash">Cash</option><option value="card">Card / POS terminal</option><option value="bank_transfer">Bank transfer</option></select></label>
              {paymentMethod !== "cash" && <label className="block text-sm font-medium">Reference (optional)<input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} className="mt-1 w-full rounded-lg border p-3" /></label>}
            </div>}
            <div className="sticky bottom-0 mt-6 flex justify-end gap-3 border-t bg-white pt-4"><Button variant="secondary" onClick={closeAction}>Cancel</Button><Button disabled={busy || (action === "credit" && reason.trim().length < 3) || (action === "payment" && (!paymentAmount || !branchId))} onClick={() => void (action === "create" || action === "edit" ? saveCustomer() : action === "credit" ? decideCredit() : recordPayment())}>{busy ? <RefreshCw className="mr-2 size-4 animate-spin" /> : null}{action === "credit" ? "Save decision" : action === "payment" ? "Record payment" : "Save customer"}</Button></div>
          </section>
        </div>
      )}
    </div>
  );
}

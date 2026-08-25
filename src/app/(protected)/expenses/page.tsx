"use client";

import { CheckCircle2, HandCoins, RefreshCw, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import { useAuth } from "@/features/auth/auth-context";
import { formatNaira, nairaToKobo } from "@/features/inventory/format";
import { hasPermission } from "@/lib/permissions/roles";
import type { OperatingExpense } from "@/types/domain";

interface Workspace {
  categories: Array<{ id: string; name: string; code: string }>;
  branches: Array<{ id: string; name: string; code: string }>;
  warehouses: Array<{ id: string; name: string; code: string }>;
  expenses: OperatingExpense[];
}
type PaymentMethod = "cash" | "card" | "bank_transfer";
interface PaymentDraft { amountNaira: string; method: PaymentMethod; reference: string }

function localDate() {
  const date = new Date(), offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

export default function ExpensesPage() {
  const { user, profile, operatingContext } = useAuth();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [payments, setPayments] = useState<Record<string, PaymentDraft>>({});
  const [form, setForm] = useState({
    categoryName: "", payeeName: "", scopeType: "organization", scopeId: "",
    expenseDate: localDate(), supplierDocumentNumber: "", description: "",
    netAmountNaira: "", vatAmountNaira: "0.00", notes: "",
  });
  const can = (permission: Parameters<typeof hasPermission>[1]) => Boolean(profile && hasPermission(profile, permission));
  const contextInput = operatingContext?.type === "branch"
    ? { branchId: operatingContext.id }
    : operatingContext?.type === "warehouse"
      ? { warehouseId: operatingContext.id }
      : {};

  async function load() {
    if (!profile) return;
    setBusy(true); setError(null);
    try {
      const result = await callAdministration<{ branchId?: string; warehouseId?: string }, Workspace>("getExpenseWorkspace", contextInput);
      setWorkspace(result);
      if (operatingContext) setForm((current) => ({ ...current, scopeType: operatingContext.type, scopeId: operatingContext.id }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Expense records could not be loaded.");
    } finally { setBusy(false); }
  }
  useEffect(() => {
    const timeout = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timeout);
    // The selected operating context is the authoritative workspace boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, operatingContext?.type, operatingContext?.id]);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true); setError(null); setMessage(null);
    try { await action(); setMessage(success); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The expense operation could not be completed."); }
    finally { setBusy(false); }
  }
  async function createExpense() {
    const scope = form.scopeType === "branch" ? { branchId: form.scopeId } : form.scopeType === "warehouse" ? { warehouseId: form.scopeId } : {};
    await run(() => callAdministration("createExpense", {
      categoryName: form.categoryName, payeeName: form.payeeName, ...scope,
      expenseDate: form.expenseDate, supplierDocumentNumber: form.supplierDocumentNumber || undefined,
      description: form.description, netAmountMinor: nairaToKobo(Number(form.netAmountNaira)),
      vatAmountMinor: nairaToKobo(Number(form.vatAmountNaira || 0)), notes: form.notes || undefined,
      idempotencyKey: crypto.randomUUID(),
    }), "Draft expense created. Review and submit it for independent approval.");
    setForm((current) => ({ ...current, categoryName: "", payeeName: "", supplierDocumentNumber: "", description: "", netAmountNaira: "", vatAmountNaira: "0.00", notes: "" }));
  }
  if (!profile || !can("expenses.read")) return <div className="rounded-xl border bg-white p-6">Your roles do not include expense access.</div>;
  const scopeOptions = form.scopeType === "branch" ? workspace?.branches ?? [] : form.scopeType === "warehouse" ? workspace?.warehouses ?? [] : [];

  return <div className="space-y-5">
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="text-xs font-semibold uppercase tracking-[.16em] text-[var(--brand)]">Expense to payment</p><h1 className="text-3xl font-semibold">Operating expenses</h1><p className="text-[var(--muted)]">Record a bill once, state VAT separately, obtain independent approval, then record only the money actually paid.</p></div>
      <Button variant="outline" disabled={busy} onClick={() => void load()}><RefreshCw className="mr-2 size-4" /> Refresh</Button>
    </header>
    {error && <div role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</div>}
    {message && <div role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">{message}</div>}

    {can("expenses.create") && <details open className="rounded-xl border bg-white p-5">
      <summary className="cursor-pointer text-lg font-semibold">1. Record an operating expense</summary>
      <p className="mt-1 text-sm text-[var(--muted)]">Type a new category or reuse an existing one. New categories are created automatically. Amounts are naira; kobo remains two decimal places.</p>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <label className="text-sm">Category<input list="expense-categories" value={form.categoryName} onChange={(event) => setForm({ ...form, categoryName: event.target.value })} placeholder="e.g. Electricity" className="mt-1 w-full rounded-lg border p-3" /><datalist id="expense-categories">{workspace?.categories.map((category) => <option key={category.id} value={category.name} />)}</datalist></label>
        <label className="text-sm">Payee<input value={form.payeeName} onChange={(event) => setForm({ ...form, payeeName: event.target.value })} placeholder="Business or person paid" className="mt-1 w-full rounded-lg border p-3" /></label>
        <label className="text-sm">Expense date<input type="date" value={form.expenseDate} onChange={(event) => setForm({ ...form, expenseDate: event.target.value })} className="mt-1 w-full rounded-lg border p-3" /></label>
        <label className="text-sm">Allocate to<select value={form.scopeType} disabled={Boolean(operatingContext)} onChange={(event) => setForm({ ...form, scopeType: event.target.value, scopeId: "" })} className="mt-1 w-full rounded-lg border p-3"><option value="organization">Whole organization</option><option value="branch">Store / branch</option><option value="warehouse">Warehouse</option></select></label>
        {form.scopeType !== "organization" && <label className="text-sm">Location<select value={form.scopeId} disabled={Boolean(operatingContext)} onChange={(event) => setForm({ ...form, scopeId: event.target.value })} className="mt-1 w-full rounded-lg border p-3"><option value="">Select location</option>{scopeOptions.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>}
        <label className="text-sm">Invoice / receipt number (optional)<input value={form.supplierDocumentNumber} onChange={(event) => setForm({ ...form, supplierDocumentNumber: event.target.value })} className="mt-1 w-full rounded-lg border p-3" /></label>
        <label className="text-sm">Net amount (₦)<input type="number" min="0.01" step="0.01" value={form.netAmountNaira} onChange={(event) => setForm({ ...form, netAmountNaira: event.target.value })} className="mt-1 w-full rounded-lg border p-3" /></label>
        <label className="text-sm">VAT (₦)<input type="number" min="0" step="0.01" value={form.vatAmountNaira} onChange={(event) => setForm({ ...form, vatAmountNaira: event.target.value })} className="mt-1 w-full rounded-lg border p-3" /></label>
        <label className="text-sm md:col-span-3">Description<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="What was purchased and why it was needed" className="mt-1 min-h-24 w-full rounded-lg border p-3" /></label>
      </div>
      <Button className="mt-4" disabled={busy || form.categoryName.trim().length < 2 || form.payeeName.trim().length < 2 || form.description.trim().length < 3 || Number(form.netAmountNaira) <= 0 || (form.scopeType !== "organization" && !form.scopeId)} onClick={() => void createExpense()}><HandCoins className="mr-2 size-4" /> Create draft expense</Button>
    </details>}

    <section className="rounded-xl border bg-white p-5">
      <h2 className="text-xl font-semibold">Expense register</h2><p className="text-sm text-[var(--muted)]">Submitting freezes the evidence. Approval recognizes the expense and payable; payment is recorded separately.</p>
      <div className="mt-4 space-y-3">{workspace?.expenses.map((expense) => {
        const draft = payments[expense.id] ?? { amountNaira: (expense.outstandingAmountMinor / 100).toFixed(2), method: "bank_transfer" as PaymentMethod, reference: "" };
        const paymentMinor = Number(draft.amountNaira) * 100;
        const validPayment = Number.isSafeInteger(paymentMinor) && paymentMinor > 0 && paymentMinor <= expense.outstandingAmountMinor;
        return <article key={expense.id} className="rounded-xl border p-4"><div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start"><div><div className="flex flex-wrap items-center gap-2"><strong>{expense.expenseNumber}</strong><span className="rounded-full bg-slate-100 px-2 py-1 text-xs capitalize">{expense.status.replaceAll("_", " ")}</span></div><p className="text-sm text-[var(--muted)]">{expense.categoryName} · {expense.payeeName} · {expense.branchName ?? expense.warehouseName ?? "Whole organization"}</p><p className="mt-1 text-sm">Net {formatNaira(expense.netAmountMinor)} + VAT {formatNaira(expense.vatAmountMinor)} = {formatNaira(expense.grossAmountMinor)}</p><p className="text-sm">Outstanding {formatNaira(expense.outstandingAmountMinor)}</p><p className="mt-1 text-sm">{expense.description}</p></div><div className="flex flex-wrap gap-2">{expense.status === "draft" && can("expenses.create") && <Button disabled={busy} onClick={() => void run(() => callAdministration("submitExpense", { expenseId: expense.id, idempotencyKey: crypto.randomUUID() }), `${expense.expenseNumber} submitted for independent approval.`)}><Send className="mr-2 size-4" /> Submit</Button>}{expense.status === "submitted" && can("expenses.approve") && expense.createdBy !== user?.uid && <Button disabled={busy} onClick={() => void run(() => callAdministration("approveExpense", { expenseId: expense.id, idempotencyKey: crypto.randomUUID() }), `${expense.expenseNumber} approved and posted to accrued expenses.`)}><CheckCircle2 className="mr-2 size-4" /> Approve</Button>}{expense.status === "submitted" && expense.createdBy === user?.uid && <span className="text-xs text-amber-800">Another authorized user must approve</span>}</div></div>
          {["approved", "partially_paid"].includes(expense.status) && can("expenses.pay") && <div className="mt-4 grid gap-2 border-t pt-4 sm:grid-cols-[10rem_11rem_minmax(0,1fr)_auto]"><input aria-label="Payment amount in naira" type="number" min="0.01" max={(expense.outstandingAmountMinor / 100).toFixed(2)} step="0.01" value={draft.amountNaira} onChange={(event) => setPayments({ ...payments, [expense.id]: { ...draft, amountNaira: event.target.value } })} className="rounded-lg border p-3" /><select aria-label="Payment method" value={draft.method} onChange={(event) => setPayments({ ...payments, [expense.id]: { ...draft, method: event.target.value as PaymentMethod } })} className="rounded-lg border p-3"><option value="bank_transfer">Bank transfer</option><option value="card">Card / POS</option><option value="cash">Cash</option></select><input value={draft.reference} onChange={(event) => setPayments({ ...payments, [expense.id]: { ...draft, reference: event.target.value } })} placeholder={draft.method === "cash" ? "Reference (optional)" : "Payment reference"} className="rounded-lg border p-3" /><Button disabled={busy || !validPayment || (draft.method !== "cash" && !draft.reference.trim())} onClick={() => void run(() => callAdministration("recordExpensePayment", { expenseId: expense.id, method: draft.method, amountMinor: nairaToKobo(Number(draft.amountNaira)), reference: draft.reference || undefined, paidAt: new Date().toISOString(), idempotencyKey: crypto.randomUUID() }), `Payment recorded against ${expense.expenseNumber}.`)}>Record payment</Button></div>}
        </article>;
      })}{!workspace?.expenses.length && <p className="rounded-lg bg-slate-50 p-6 text-center text-sm text-[var(--muted)]">No operating expenses recorded for this context.</p>}</div>
    </section>
  </div>;
}

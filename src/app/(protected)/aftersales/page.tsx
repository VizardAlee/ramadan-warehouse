"use client";

import { RefreshCw, Wrench } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import { useAuth } from "@/features/auth/auth-context";
import { formatNaira, nairaToKobo } from "@/features/inventory/format";
import { hasPermission } from "@/lib/permissions/roles";

interface Case {
  id: string;
  branchId: string;
  customerName: string;
  productName?: string;
  saleNumber?: string;
  serialNumber?: string;
  serviceType: "warranty" | "non_warranty";
  requestType: string;
  complaint: string;
  status: string;
  resolution?: string;
  chargeStatus: string;
  chargeAmountMinor?: number;
  amountPaidMinor?: number;
  outstandingAmountMinor?: number;
}
interface Workspace {
  cases: Case[];
  customers: Array<{ id: string; name: string; customerNumber: string }>;
  products: Array<{ id: string; name: string; sku: string }>;
  bankAccounts: Array<{ id: string; bankName: string; accountName: string; accountNumberLast4: string }>;
  sales: Array<{ id: string; saleNumber: string; branchId: string; customerId: string | null }>;
}
const transitions: Record<string, Array<{ value: string; label: string }>> = {
  open: [{ value: "diagnosed", label: "Diagnosed" }, { value: "cancelled", label: "Cancelled" }],
  diagnosed: [{ value: "in_service", label: "In service" }, { value: "awaiting_collection", label: "Ready for collection" }, { value: "cancelled", label: "Cancelled" }],
  in_service: [{ value: "awaiting_collection", label: "Ready for collection" }, { value: "cancelled", label: "Cancelled" }],
  awaiting_collection: [{ value: "completed", label: "Completed" }],
};

export default function AftersalesPage() {
  const { profile, operatingContext } = useAuth();
  const can = (permission: Parameters<typeof hasPermission>[1]) => Boolean(profile && hasPermission(profile, permission));
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    customerId: "", saleId: "", productId: "", serialNumber: "",
    serviceType: "warranty" as "warranty" | "non_warranty",
    requestType: "warranty", complaint: "", notes: "",
  });
  const [caseDrafts, setCaseDrafts] = useState<Record<string, {
    status: string;
    resolution: string;
    chargeNaira: string;
    chargeReason: string;
    paymentNaira: string;
    method: "cash" | "card" | "bank_transfer";
    bankAccountId: string;
    reference: string;
  }>>({});
  const branchId = operatingContext?.type === "branch" ? operatingContext.id : "";

  const load = useCallback(async () => {
    if (!profile || !can("sales.returns.read")) return;
    setBusy(true);
    setError(null);
    try {
      setWorkspace(await callAdministration("getAftersalesWorkspace", { branchId: branchId || undefined }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Aftersales cases could not be loaded.");
    } finally {
      setBusy(false);
    }
    // `can` derives from profile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, branchId]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      setMessage(success);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The aftersales action could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  if (!profile || !can("sales.returns.read"))
    return <div className="rounded-xl border bg-white p-6">Your roles do not include aftersales access.</div>;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-[var(--brand)]">Customer service</p>
          <h1 className="text-3xl font-semibold">Aftersales</h1>
          <p className="max-w-3xl text-[var(--muted)]">Track warranty and non-warranty requests, diagnosis, service, collection, complimentary work, and payments without changing the original sale or inventory history.</p>
        </div>
        <Button variant="outline" disabled={busy} onClick={() => void load()}><RefreshCw className="mr-2 size-4" /> Refresh</Button>
      </header>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {message && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">{message}</p>}
      {can("sales.returns.create") && (
        <section className="rounded-xl border bg-white p-5">
          <h2 className="flex items-center gap-2 text-xl font-semibold"><Wrench className="size-5" /> New service request</h2>
          {!branchId && <p className="mt-2 text-sm text-amber-800">Select a store in the location switcher before creating a case.</p>}
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-sm font-medium">Customer<select value={draft.customerId} onChange={(event) => setDraft({ ...draft, customerId: event.target.value })} className="mt-1 w-full rounded-lg border p-3"><option value="">Select customer</option>{workspace?.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} · {customer.customerNumber}</option>)}</select></label>
            <label className="text-sm font-medium">Product (optional)<select value={draft.productId} onChange={(event) => setDraft({ ...draft, productId: event.target.value })} className="mt-1 w-full rounded-lg border p-3"><option value="">Service only</option>{workspace?.products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.sku}</option>)}</select></label>
            <label className="text-sm font-medium">Related sale (optional)<select value={draft.saleId} onChange={(event) => setDraft({ ...draft, saleId: event.target.value })} className="mt-1 w-full rounded-lg border p-3"><option value="">No linked sale</option>{workspace?.sales.filter((sale) => sale.branchId === branchId && (!sale.customerId || sale.customerId === draft.customerId)).map((sale) => <option key={sale.id} value={sale.id}>{sale.saleNumber}</option>)}</select></label>
            <label className="text-sm font-medium">Serial number (optional)<input value={draft.serialNumber} onChange={(event) => setDraft({ ...draft, serialNumber: event.target.value })} className="mt-1 w-full rounded-lg border p-3" /></label>
            <label className="text-sm font-medium">Coverage<select value={draft.serviceType} onChange={(event) => setDraft({ ...draft, serviceType: event.target.value as typeof draft.serviceType })} className="mt-1 w-full rounded-lg border p-3"><option value="warranty">Warranty</option><option value="non_warranty">Non-warranty</option></select></label>
            <label className="text-sm font-medium">Request type<select value={draft.requestType} onChange={(event) => setDraft({ ...draft, requestType: event.target.value })} className="mt-1 w-full rounded-lg border p-3">{["warranty", "installation", "repair", "replacement", "inspection", "maintenance", "technical_support"].map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
            <label className="text-sm font-medium sm:col-span-2 lg:col-span-3">Complaint / request<textarea value={draft.complaint} onChange={(event) => setDraft({ ...draft, complaint: event.target.value })} className="mt-1 min-h-24 w-full rounded-lg border p-3" /></label>
          </div>
          <Button className="mt-4" disabled={busy || !branchId || !draft.customerId || draft.complaint.trim().length < 5} onClick={() => void run(() => callAdministration("createAftersalesCase", {
            branchId,
            customerId: draft.customerId,
            saleId: draft.saleId || undefined,
            productId: draft.productId || undefined,
            serialNumber: draft.serialNumber || undefined,
            serviceType: draft.serviceType,
            requestType: draft.requestType,
            complaint: draft.complaint,
            notes: draft.notes || undefined,
            idempotencyKey: crypto.randomUUID(),
          }), "Service case recorded.")}>Create case</Button>
        </section>
      )}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Service cases</h2>
        {workspace?.cases.map((item) => {
          const form = caseDrafts[item.id] ?? { status: "", resolution: "", chargeNaira: "", chargeReason: "", paymentNaira: "", method: "cash" as const, bankAccountId: "", reference: "" };
          const set = (changes: Partial<typeof form>) => setCaseDrafts({ ...caseDrafts, [item.id]: { ...form, ...changes } });
          const chargeMinor = Number(form.chargeNaira) * 100;
          const paymentMinor = Number(form.paymentNaira) * 100;
          return (
            <article key={item.id} className="rounded-xl border bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <strong>{item.customerName} · {item.requestType.replaceAll("_", " ")}</strong>
                  <p className="text-sm text-[var(--muted)]">{item.productName || "Service only"} · {item.serviceType.replaceAll("_", " ")} · {item.saleNumber || "No linked sale"} {item.serialNumber && `· Serial ${item.serialNumber}`}</p>
                  <p className="mt-2 text-sm">{item.complaint}</p>
                  {item.resolution && <p className="mt-1 text-sm"><strong>Resolution:</strong> {item.resolution}</p>}
                </div>
                <div className="text-right text-sm"><span className="rounded-full bg-slate-100 px-3 py-1 capitalize">{item.status.replaceAll("_", " ")}</span><p className="mt-2 capitalize">{item.chargeStatus.replaceAll("_", " ")}</p>{item.chargeAmountMinor !== undefined && <p>{formatNaira(item.amountPaidMinor ?? 0)} paid / {formatNaira(item.chargeAmountMinor)}</p>}</div>
              </div>
              {can("sales.returns.approve") && !["completed", "cancelled"].includes(item.status) && (
                <div className="mt-4 grid gap-3 border-t pt-4 md:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto]">
                  <select aria-label="Next service status" value={form.status} onChange={(event) => set({ status: event.target.value })} className="rounded-lg border p-3"><option value="">Next status</option>{(transitions[item.status] ?? []).map((step) => <option key={step.value} value={step.value}>{step.label}</option>)}</select>
                  <input aria-label="Resolution or status reason" value={form.resolution} onChange={(event) => set({ resolution: event.target.value })} placeholder="Resolution / reason" className="min-w-0 rounded-lg border p-3" />
                  <Button disabled={busy || !form.status || form.resolution.trim().length < 5 || (form.status === "completed" && item.chargeStatus === "not_quoted")} onClick={() => void run(() => callAdministration("updateAftersalesCase", { caseId: item.id, status: form.status, resolution: form.resolution, idempotencyKey: crypto.randomUUID() }), "Case status updated and audited.")}>Update status</Button>
                </div>
              )}
              {can("sales.returns.approve") && item.chargeStatus === "not_quoted" && !["completed", "cancelled"].includes(item.status) && (
                <div className="mt-3 grid gap-3 md:grid-cols-[10rem_minmax(0,1fr)_auto]">
                  <label className="text-sm">Service charge (₦)<input type="number" min="0" step="0.01" value={form.chargeNaira} onChange={(event) => set({ chargeNaira: event.target.value })} className="mt-1 w-full rounded-lg border p-3" /></label>
                  <label className="text-sm">Charge / complimentary reason<input value={form.chargeReason} onChange={(event) => set({ chargeReason: event.target.value })} className="mt-1 w-full rounded-lg border p-3" /></label>
                  <Button className="self-end" disabled={busy || !Number.isSafeInteger(chargeMinor) || chargeMinor < 0 || form.chargeNaira === "" || form.chargeReason.trim().length < 5} onClick={() => void run(() => callAdministration("setAftersalesCharge", { caseId: item.id, chargeAmountMinor: nairaToKobo(Number(form.chargeNaira)), reason: form.chargeReason, idempotencyKey: crypto.randomUUID() }), "Service charge recorded.")}>Set charge</Button>
                </div>
              )}
              {can("customers.payment.record") && (item.outstandingAmountMinor ?? 0) > 0 && item.status !== "cancelled" && (
                <div className="mt-3 grid gap-3 border-t pt-4 sm:grid-cols-2 lg:grid-cols-[10rem_10rem_minmax(12rem,1fr)_minmax(12rem,1fr)_auto]">
                  <label className="text-sm">Pay now (₦)<input type="number" min="0.01" max={((item.outstandingAmountMinor ?? 0) / 100).toFixed(2)} step="0.01" value={form.paymentNaira} onChange={(event) => set({ paymentNaira: event.target.value })} className="mt-1 w-full rounded-lg border p-3" /></label>
                  <label className="text-sm">Method<select value={form.method} onChange={(event) => set({ method: event.target.value as typeof form.method, bankAccountId: "" })} className="mt-1 w-full rounded-lg border p-3"><option value="cash">Cash</option><option value="card">Card / POS</option><option value="bank_transfer">Bank transfer</option></select></label>
                  <label className="text-sm">Receiving account<select disabled={form.method === "cash"} value={form.bankAccountId} onChange={(event) => set({ bankAccountId: event.target.value })} className="mt-1 w-full rounded-lg border p-3 disabled:bg-slate-100"><option value="">{form.method === "cash" ? "Cash on hand" : "Select account"}</option>{workspace.bankAccounts.map((account) => <option key={account.id} value={account.id}>{account.bankName} · {account.accountName} · ••••{account.accountNumberLast4}</option>)}</select></label>
                  <label className="text-sm">Reference (optional)<input value={form.reference} onChange={(event) => set({ reference: event.target.value })} className="mt-1 w-full rounded-lg border p-3" /></label>
                  <Button className="self-end" disabled={busy || !Number.isSafeInteger(paymentMinor) || paymentMinor <= 0 || paymentMinor > (item.outstandingAmountMinor ?? 0) || (form.method !== "cash" && !form.bankAccountId)} onClick={() => void run(() => callAdministration("recordAftersalesPayment", { caseId: item.id, method: form.method, bankAccountId: form.bankAccountId || undefined, amountMinor: nairaToKobo(Number(form.paymentNaira)), reference: form.reference || undefined, idempotencyKey: crypto.randomUUID() }), "Payment recorded and posted to the journal.")}>Record payment</Button>
                </div>
              )}
            </article>
          );
        })}
        {workspace && !workspace.cases.length && <p className="rounded-xl border bg-white p-6 text-center text-sm text-[var(--muted)]">No aftersales cases in this location.</p>}
      </section>
    </div>
  );
}

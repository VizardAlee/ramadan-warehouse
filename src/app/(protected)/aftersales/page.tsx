"use client";
import { FinancialAction, FinancialActionScope, FinancialInput, FinancialMessage, FinancialText, FinancialValue  } from "@/features/finance/financial-privacy";

import { RefreshCw, Wrench } from "lucide-react";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import { useAuth } from "@/features/auth/auth-context";
import { formatNaira, nairaToKobo } from "@/features/inventory/format";
import { hasPermission } from "@/lib/permissions/roles";
import { OperationalPhotos } from "@/features/pos/operational-photos";
import { HeldReturnDisposition, type HeldReturnCase } from "@/features/returns/held-return-disposition";
import { ServicePayments } from "@/features/returns/service-payments";

interface Case extends HeldReturnCase {
  id: string;
  branchId: string;
  customerName: string;
  productName?: string;
  saleNumber?: string;
  serialNumber?: string;
  returnNumber?: string;
  quantity?: number;
  contactPhone?: string;
  serviceType: "warranty" | "non_warranty";
  requestType: string;
  complaint: string;
  status: string;
  resolution?: string;
  chargeStatus: string;
  billingSaleId?: string;
  billedCreditedMinor?: number;
  chargeAmountMinor?: number;
  amountPaidMinor?: number;
  outstandingAmountMinor?: number;
  assignedStaff?: { employeeId: string; staffId: string; name: string } | null;
  assignmentReason?: string;
  serviceCatalog?: { name: string; grossAmountMinor: number; vatRateBasisPoints: number; priceVersion: number } | null;
  chargeVatMinor?: number;
}
interface Workspace {
  cases: Case[];
  customers: Array<{ id: string; name: string; customerNumber: string }>;
  products: Array<{ id: string; name: string; sku: string }>;
  serviceItems?: Array<{ id: string; name: string; sku: string; grossAmountMinor: number }>;
  bankAccounts: Array<{ id: string; bankName: string; accountName: string; accountNumberLast4: string }>;
  suppliers: Array<{ id: string; name: string }>;
  sales: Array<{ id: string; saleNumber: string; branchId: string; customerId: string | null }>;
}
const transitions: Record<string, Array<{ value: string; label: string }>> = {
  open: [{ value: "diagnosed", label: "Diagnosed" }, { value: "cancelled", label: "Cancelled" }],
  diagnosed: [{ value: "in_service", label: "In service" }, { value: "awaiting_collection", label: "Ready for collection" }, { value: "cancelled", label: "Cancelled" }],
  in_service: [{ value: "awaiting_collection", label: "Ready for collection" }, { value: "cancelled", label: "Cancelled" }],
  awaiting_collection: [{ value: "completed", label: "Completed" }],
};

export default function AftersalesPage() {
  const { profile, user } = useAuth();
  return <Suspense fallback={<p role="status">Loading aftersales…</p>}><AftersalesWorkspace key={`${profile?.organizationId}:${user?.uid}`} /></Suspense>;
}

const mutationNames = ["createAftersalesCase", "updateAftersalesCase", "setAftersalesCharge", "recordAftersalesPayment"];
function minorOrNaN(value: string) { try { return value.trim() ? nairaToKobo(Number(value)) : Number.NaN; } catch { return Number.NaN; } }

function AftersalesWorkspace() {
  const caseId = useSearchParams().get("caseId");
  const { profile, user, operatingContext } = useAuth();
  const can = (permission: Parameters<typeof hasPermission>[1]) => Boolean(profile && hasPermission(profile, permission));
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const storageKey = `abr-pending-aftersales:${profile?.organizationId}:${user?.uid}`;
  const [pending, setPending] = useState<{ name: string; input: Record<string, unknown> } | null>(null);
  const [ready, setReady] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const mutationFlight = useRef(false);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = sessionStorage.getItem(storageKey);
        const instruction = saved ? JSON.parse(saved) : null;
        if (instruction && (!mutationNames.includes(instruction.name) || !instruction.input ||
          typeof instruction.input !== "object" || Array.isArray(instruction.input) || typeof instruction.input.idempotencyKey !== "string"))
          throw new Error("Invalid saved service instructions");
        setPending(instruction); setReady(true);
      } catch { setReady(false); setRecoveryError("Saved service instructions could not be read. Restore browser storage before recording another action."); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [storageKey]);
  const [draft, setDraft] = useState({
    customerId: "", saleId: "", productId: "", serviceItemId: "", serialNumber: "",
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
    staffId: string;
    assignmentReason: string;
  }>>({});
  const branchId = operatingContext?.type === "branch" ? operatingContext.id : "";

  const load = useCallback(async () => {
    if (!profile || !can("sales.returns.read")) return;
    setBusy(true);
    setError(null);
    try {
      setWorkspace(await callAdministration("getAftersalesWorkspace", caseId ? { caseId } : { branchId: branchId || undefined }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Aftersales cases could not be loaded.");
    } finally {
      setBusy(false);
    }
    // `can` derives from profile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, branchId, caseId]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function run(name: string, input: Record<string, unknown>, success: string, retry = false) {
    if (!ready || mutationFlight.current || (pending && !retry)) return false;
    mutationFlight.current = true;
    const instruction = retry && pending ? pending : { name, input };
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(instruction)); setPending(instruction);
      await callAdministration(instruction.name, instruction.input);
      sessionStorage.removeItem(storageKey); setPending(null);
      setMessage(success);
      setCaseDrafts({});
      if (instruction.name === "createAftersalesCase") setDraft(current => ({ ...current, customerId: "", saleId: "", productId: "", serviceItemId: "", serialNumber: "", complaint: "", notes: "" }));
      await load();
      return true;
    } catch (cause) {
      const diagnostic = cause as { diagnosticCode?: string; code?: string };
      if (!retry && ["functions/invalid-argument", "functions/permission-denied", "functions/failed-precondition", "functions/not-found", "functions/already-exists"].includes(diagnostic.diagnosticCode ?? diagnostic.code ?? "")) {
        sessionStorage.removeItem(storageKey); setPending(null);
      }
      setError(cause instanceof Error ? cause.message : "The aftersales action could not be completed.");
      return false;
    } finally {
      mutationFlight.current = false;
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
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800"><FinancialMessage>{error}</FinancialMessage></p>}
      {recoveryError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800"><FinancialText>{recoveryError}</FinancialText></p>}
      {message && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900"><FinancialMessage>{message}</FinancialMessage></p>}
      {pending && <div className="rounded-xl bg-amber-50 p-4" role="status"><p>A service action is unconfirmed. Retry the saved instructions before recording another action. Do not accept the same payment twice.</p><FinancialAction retry={Boolean(pending)}><Button disabled={busy || !ready} onClick={() => void run(pending.name, pending.input, "Saved service action confirmed.", true)}>Retry saved service instructions</Button></FinancialAction></div>}
      <fieldset disabled={busy || !ready || !!pending} className="min-w-0 space-y-5">
      {can("sales.returns.create") && (
        <section className="rounded-xl border bg-white p-5">
          <h2 className="flex items-center gap-2 text-xl font-semibold"><Wrench className="size-5" /> New service request</h2>
          {!branchId && <p className="mt-2 text-sm text-amber-800">Select a store in the location switcher before creating a case.</p>}
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-sm font-medium">Customer<select value={draft.customerId} onChange={(event) => setDraft({ ...draft, customerId: event.target.value })} className="mt-1 w-full rounded-lg border p-3"><option value="">Select customer</option>{workspace?.customers.map((customer) => <option key={customer.id} value={customer.id}><FinancialText>{customer.name}</FinancialText> · <FinancialText>{customer.customerNumber}</FinancialText></option>)}</select></label>
            <label className="text-sm font-medium">Catalogue service (optional)<select value={draft.serviceItemId} onChange={event => setDraft({ ...draft, serviceItemId: event.target.value })} className="mt-1 w-full rounded-lg border p-3"><option value="">Custom service / existing warranty</option>{workspace?.serviceItems?.map(item => <option key={item.id} value={item.id}><FinancialText>{item.name}</FinancialText> · <FinancialValue textOnly>{formatNaira(item.grossAmountMinor)}</FinancialValue> including configured VAT</option>)}</select><span className="mt-1 block text-xs text-[var(--muted)]">The case keeps this service price version. Staff still confirm the charge or complimentary reason.</span></label>
            <label className="text-sm font-medium">Product (optional)<select value={draft.productId} onChange={(event) => setDraft({ ...draft, productId: event.target.value })} className="mt-1 w-full rounded-lg border p-3"><option value="">Service only</option>{workspace?.products.map((product) => <option key={product.id} value={product.id}><FinancialText>{product.name}</FinancialText> · <FinancialText>{product.sku}</FinancialText></option>)}</select></label>
            <label className="text-sm font-medium">Related sale (optional)<select value={draft.saleId} onChange={(event) => setDraft({ ...draft, saleId: event.target.value })} className="mt-1 w-full rounded-lg border p-3"><option value="">No linked sale</option>{workspace?.sales.filter((sale) => sale.branchId === branchId && (!sale.customerId || sale.customerId === draft.customerId)).map((sale) => <option key={sale.id} value={sale.id}><FinancialText>{sale.saleNumber}</FinancialText></option>)}</select></label>
            <label className="text-sm font-medium">Serial number (optional)<input value={draft.serialNumber} onChange={(event) => setDraft({ ...draft, serialNumber: event.target.value })} className="mt-1 w-full rounded-lg border p-3" /></label>
            <label className="text-sm font-medium">Coverage<select value={draft.serviceType} onChange={(event) => setDraft({ ...draft, serviceType: event.target.value as typeof draft.serviceType })} className="mt-1 w-full rounded-lg border p-3"><option value="warranty">Warranty</option><option value="non_warranty">Non-warranty</option></select></label>
            <label className="text-sm font-medium">Request type<select value={draft.requestType} onChange={(event) => setDraft({ ...draft, requestType: event.target.value })} className="mt-1 w-full rounded-lg border p-3">{["warranty", "installation", "repair", "replacement", "inspection", "maintenance", "technical_support"].map((value) => <option key={value} value={value}><FinancialText>{value.replaceAll("_", " ")}</FinancialText></option>)}</select></label>
            <label className="text-sm font-medium sm:col-span-2 lg:col-span-3">Complaint / request<textarea value={draft.complaint} onChange={(event) => setDraft({ ...draft, complaint: event.target.value })} className="mt-1 min-h-24 w-full rounded-lg border p-3" /></label>
          </div>
          <Button className="mt-4" aria-busy={busy} disabledReason={!branchId ? "Choose the authorized operating store in Working location." : !draft.customerId ? "Select a named customer; ask the authorized customer manager to register one if absent." : draft.complaint.trim().length < 5 ? "Describe the actual complaint or request in at least 5 characters." : undefined} disabled={busy || !branchId || !draft.customerId || draft.complaint.trim().length < 5} onClick={() => void run("createAftersalesCase", {
            branchId,
            customerId: draft.customerId,
            saleId: draft.saleId || undefined,
            productId: draft.productId || undefined,
            serviceItemId: draft.serviceItemId || undefined,
            serialNumber: draft.serialNumber || undefined,
            serviceType: draft.serviceType,
            requestType: draft.requestType,
            complaint: draft.complaint,
            notes: draft.notes || undefined,
            idempotencyKey: crypto.randomUUID(),
          }, "Service case recorded.")}>Create case</Button>
        </section>
      )}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Service cases</h2>
        {workspace?.cases.map((item) => {
          const form = caseDrafts[item.id] ?? { status: "", resolution: "", chargeNaira: item.serviceCatalog && item.serviceType === "non_warranty" ? (item.serviceCatalog.grossAmountMinor / 100).toFixed(2) : "", chargeReason: "", paymentNaira: "", method: "cash" as const, bankAccountId: "", reference: "", staffId: item.assignedStaff?.staffId ?? "", assignmentReason: "" };
          const set = (changes: Partial<typeof form>) => setCaseDrafts({ ...caseDrafts, [item.id]: { ...form, ...changes } });
          const chargeMinor = minorOrNaN(form.chargeNaira);
          const paymentMinor = minorOrNaN(form.paymentNaira);
          return (
            <FinancialActionScope key={item.id}><article key={item.id} className="rounded-xl border bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <strong><FinancialText>{item.customerName}</FinancialText> · <FinancialText>{item.requestType.replaceAll("_", " ")}</FinancialText></strong>
                  <p className="text-sm text-[var(--muted)]"><FinancialText>{item.productName || "Service only"}</FinancialText> · <FinancialText>{item.serviceType.replaceAll("_", " ")}</FinancialText> · <FinancialText>{item.saleNumber || "No linked sale"}</FinancialText> <FinancialText>{item.serialNumber && `· Serial ${item.serialNumber}`}</FinancialText></p>
                  {item.returnNumber && <p className="mt-2 text-sm">From inspected return <FinancialText>{item.returnNumber}</FinancialText> · <FinancialText>{(item.quantity ?? 0) - (item.heldDisposedQuantity ?? 0)}</FinancialText> unit(s) still held <FinancialText>{item.contactPhone && `· ${item.contactPhone}`}</FinancialText><br />Completing service does not restock goods or issue a refund. <Link href="/aftersales" className="underline">View all service cases</Link></p>}
                  <p className="mt-2 text-sm"><FinancialText>{item.complaint}</FinancialText></p>
                  {item.serviceCatalog && <p className="mt-2 text-sm"><strong>Service:</strong> <FinancialText>{item.serviceCatalog.name}</FinancialText> · catalogue <FinancialValue>{formatNaira(item.serviceCatalog.grossAmountMinor)}</FinancialValue> incl. VAT · price version <FinancialText>{item.serviceCatalog.priceVersion}</FinancialText>. No physical stock is reserved or released.</p>}
                  {item.chargeVatMinor !== undefined && <p className="text-sm text-[var(--muted)]">Confirmed charge includes <FinancialValue>{formatNaira(item.chargeVatMinor)}</FinancialValue> configured VAT; part payments allocate it without duplicating income.</p>}
                  {item.serviceCatalog && item.chargeStatus === "not_quoted" && <p className="text-sm text-[var(--muted)]">Enter the total service charge including configured VAT, or zero for complimentary work, with a reason. Changing catalogue prices later will not alter this case.</p>}
                  {can("expenses.create") && can("expenses.read") && <Link className="mt-3 inline-block text-sm font-semibold underline" href={`/expenses?caseId=${encodeURIComponent(item.id)}&branchId=${encodeURIComponent(item.branchId)}`}>Record outsourced service / logistics cost</Link>}
                  {item.resolution && <p className="mt-1 text-sm"><strong>Resolution:</strong> <FinancialText>{item.resolution}</FinancialText></p>}
                  <p className="mt-2 text-sm"><strong>Responsible assignee:</strong> <FinancialText>{item.assignedStaff ? `${item.assignedStaff.name} · ${item.assignedStaff.staffId}` : "Not assigned"}</FinancialText></p>
                  {item.assignmentReason && <p className="text-sm text-[var(--muted)]">Assignment: <FinancialText>{item.assignmentReason}</FinancialText></p>}
                </div>
                <div className="text-right text-sm"><span className="rounded-full bg-slate-100 px-3 py-1 capitalize"><FinancialText>{item.status.replaceAll("_", " ")}</FinancialText></span><p className="mt-2 capitalize"><FinancialText>{item.chargeStatus.replaceAll("_", " ")}</FinancialText></p>{item.chargeAmountMinor !== undefined && <p><FinancialValue>{formatNaira(item.amountPaidMinor ?? 0)}</FinancialValue> paid / <FinancialValue>{formatNaira(item.chargeAmountMinor)}</FinancialValue></p>}</div>
              </div>
              <OperationalPhotos kind="aftersales" recordId={item.id} stage={item.status === "open" ? "intake" : ["diagnosed", "in_service"].includes(item.status) ? "diagnosis" : "handover"} serials={item.serialNumber ? [item.serialNumber] : []} canUpload={item.status !== "cancelled" && can(item.status === "open" ? "sales.returns.create" : "sales.returns.approve")} />
              <HeldReturnDisposition record={item} suppliers={workspace.suppliers ?? []} canDispose={can("sales.returns.approve") && can("inventory.adjust")} canHandover={can("procurement.receive") && can("suppliers.read")} canReadHistory={can("inventory.read")} canReadSettlement={can("procurement.read") && can("payables.read")} canSettle={can("procurement.receive") && can("payables.approve") && can("sales.returns.approve")} canReceiveReplacement={can("procurement.receive") && can("inventory.receive") && can("sales.returns.approve")} onComplete={() => void load()} />
              {item.billingSaleId && <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm">Billed on invoice <FinancialText>{item.billingSaleId}</FinancialText>. <Link href="/returns" className="font-semibold underline">Open Returns &amp; corrections</Link> and load the invoice receipt for repayments, receipt corrections and service credits. Original service receipts remain in history; they are not received again.</p>}
              <ServicePayments key={`${item.id}:${item.amountPaidMinor ?? 0}`} caseId={item.id} accounts={workspace.bankAccounts} mutationError={error} disabled={busy || !ready || Boolean(pending)} canRefund={!item.billingSaleId && can("sales.returns.approve") && can("customers.payment.record")} onRefund={input => run("recordAftersalesPayment", input, "Service receipt refunded; the charge remains due. The refund and journal are recorded.")} />
              {can("sales.returns.approve") && !["completed", "cancelled"].includes(item.status) && <details className="mt-4 rounded-lg border p-3">
                <summary className="cursor-pointer text-sm font-semibold">Assign / change service staff</summary>
                <p className="mt-2 text-sm text-[var(--muted)]">Use the employee&apos;s staff ID from HR. They need not have an app account. Only active staff in this store, or organization-wide staff, can be assigned. Leave the ID blank to remove the assignment.</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto]">
                  <label className="text-sm">HR staff ID<input maxLength={40} value={form.staffId} onChange={event => set({ staffId: event.target.value })} className="mt-1 w-full rounded-lg border p-3" /></label>
                  <label className="text-sm">Assignment reason<input maxLength={500} value={form.assignmentReason} onChange={event => set({ assignmentReason: event.target.value })} className="mt-1 w-full rounded-lg border p-3" /></label>
                  <Button className="self-end" aria-busy={busy} disabledReason={form.assignmentReason.trim().length < 5 ? "Enter the assignment reason, at least 5 characters." : form.staffId.trim() !== "" && !/^[A-Za-z0-9-]{2,40}$/.test(form.staffId.trim()) ? "Use the registered Staff ID: 2–40 letters, numbers or hyphens. Ask HR to verify the active eligible employee." : !item.assignedStaff && !form.staffId.trim() ? "Enter the existing eligible Staff ID. Ask HR if no employee is available." : undefined} disabled={busy || form.assignmentReason.trim().length < 5 || (form.staffId.trim() !== "" && !/^[A-Za-z0-9-]{2,40}$/.test(form.staffId.trim())) || (!item.assignedStaff && !form.staffId.trim())} onClick={() => void run("updateAftersalesCase", { caseId: item.id, action: "assign_staff", staffId: form.staffId.trim() || null, reason: form.assignmentReason, idempotencyKey: crypto.randomUUID() }, "Service staff assignment saved and audited.")}>Save staff assignment</Button>
                </div>
              </details>}
              {can("sales.returns.approve") && !["completed", "cancelled"].includes(item.status) && (
                <div className="mt-4 grid gap-3 border-t pt-4 md:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto]">
                  <select aria-label="Next service status" value={form.status} onChange={(event) => set({ status: event.target.value })} className="rounded-lg border p-3"><option value="">Next status</option>{(transitions[item.status] ?? []).map((step) => <option key={step.value} value={step.value}><FinancialText>{step.label}</FinancialText></option>)}</select>
                  <input aria-label="Resolution or status reason" value={form.resolution} onChange={(event) => set({ resolution: event.target.value })} placeholder="Resolution / reason" className="min-w-0 rounded-lg border p-3" />
                  <Button aria-busy={busy} disabledReason={!form.status ? "Choose a permitted next service status." : form.resolution.trim().length < 5 ? "Describe the resolution in at least 5 characters." : form.status === "completed" && item.chargeStatus === "not_quoted" ? "Authorized service staff must set the actual charge or a reasoned complimentary zero charge before completion." : undefined} disabled={busy || !form.status || form.resolution.trim().length < 5 || (form.status === "completed" && item.chargeStatus === "not_quoted")} onClick={() => void run("updateAftersalesCase", { caseId: item.id, status: form.status, resolution: form.resolution, idempotencyKey: crypto.randomUUID() }, "Case status updated and audited.")}>Update status</Button>
                </div>
              )}
              {!item.billingSaleId && can("sales.returns.approve") && item.chargeStatus === "not_quoted" && !["completed", "cancelled"].includes(item.status) && (
                <div className="mt-3 grid gap-3 md:grid-cols-[10rem_minmax(0,1fr)_auto]">
                  <label className="text-sm">Service charge (₦)<FinancialInput><input type="number" min="0" step="0.01" value={form.chargeNaira} onChange={(event) => set({ chargeNaira: event.target.value })} className="mt-1 w-full rounded-lg border p-3" /></FinancialInput></label>
                  <label className="text-sm">Charge / complimentary reason<input value={form.chargeReason} onChange={(event) => set({ chargeReason: event.target.value })} className="mt-1 w-full rounded-lg border p-3" /></label>
                  <FinancialAction><Button className="self-end" aria-busy={busy} disabledReason={!Number.isSafeInteger(chargeMinor) || chargeMinor < 0 || form.chargeNaira === "" ? "Enter the real nonnegative charge with at most two decimal places. Zero is permitted for a complimentary service." : form.chargeReason.trim().length < 5 ? "Enter the actual charge or complimentary-service reason, at least 5 characters." : undefined} disabled={busy || !Number.isSafeInteger(chargeMinor) || chargeMinor < 0 || form.chargeNaira === "" || form.chargeReason.trim().length < 5} onClick={() => void run("setAftersalesCharge", { caseId: item.id, chargeAmountMinor: chargeMinor, reason: form.chargeReason, idempotencyKey: crypto.randomUUID() }, "Service charge recorded.")}>Set charge</Button></FinancialAction>
                </div>
              )}
              {!item.billingSaleId && can("customers.payment.record") && (item.outstandingAmountMinor ?? 0) > 0 && item.status !== "cancelled" && (
                <div className="mt-3 grid gap-3 border-t pt-4 sm:grid-cols-2 lg:grid-cols-[10rem_10rem_minmax(12rem,1fr)_minmax(12rem,1fr)_auto]">
                  <label className="text-sm">Pay now (₦)<FinancialInput><input type="number" min="0.01" max={((item.outstandingAmountMinor ?? 0) / 100).toFixed(2)} step="0.01" value={form.paymentNaira} onChange={(event) => set({ paymentNaira: event.target.value })} className="mt-1 w-full rounded-lg border p-3" /></FinancialInput></label>
                  <label className="text-sm">Method<select value={form.method} onChange={(event) => set({ method: event.target.value as typeof form.method, bankAccountId: "" })} className="mt-1 w-full rounded-lg border p-3"><option value="cash">Cash</option><option value="card">Card / POS</option><option value="bank_transfer">Bank transfer</option></select></label>
                  <label className="text-sm">Receiving account<select disabled={form.method === "cash"} value={form.bankAccountId} onChange={(event) => set({ bankAccountId: event.target.value })} className="mt-1 w-full rounded-lg border p-3 disabled:bg-slate-100"><option value=""><FinancialText>{form.method === "cash" ? "Cash on hand" : "Select account"}</FinancialText></option>{workspace.bankAccounts.map((account) => <option key={account.id} value={account.id}><FinancialText>{account.bankName}</FinancialText> · <FinancialText>{account.accountName}</FinancialText> · ••••<FinancialText>{account.accountNumberLast4}</FinancialText></option>)}</select></label>
                  <label className="text-sm">Reference (optional)<input value={form.reference} onChange={(event) => set({ reference: event.target.value })} className="mt-1 w-full rounded-lg border p-3" /></label>
                  <FinancialAction><Button className="self-end" aria-busy={busy} disabledReason={!Number.isSafeInteger(paymentMinor) || paymentMinor <= 0 ? "Enter the actual positive payment with at most two decimal places." : paymentMinor > (item.outstandingAmountMinor ?? 0) ? `Payment cannot exceed the recorded outstanding ${formatNaira(item.outstandingAmountMinor ?? 0)}. Ask finance to reconcile receipt evidence if this is incorrect.` : form.method !== "cash" && !form.bankAccountId ? "Select an active receiving company account. Ask finance to configure it if the list is empty." : undefined} disabled={busy || !Number.isSafeInteger(paymentMinor) || paymentMinor <= 0 || paymentMinor > (item.outstandingAmountMinor ?? 0) || (form.method !== "cash" && !form.bankAccountId)} onClick={() => void run("recordAftersalesPayment", { caseId: item.id, method: form.method, bankAccountId: form.bankAccountId || undefined, amountMinor: paymentMinor, reference: form.reference || undefined, idempotencyKey: crypto.randomUUID() }, "Payment recorded and posted to the journal.")}>Record payment</Button></FinancialAction>
                </div>
              )}
            </article></FinancialActionScope>
          );
        })}
        {workspace && !workspace.cases.length && <p className="rounded-xl border bg-white p-6 text-center text-sm text-[var(--muted)]">No aftersales cases in this location.</p>}
      </section>
      </fieldset>
    </div>
  );
}

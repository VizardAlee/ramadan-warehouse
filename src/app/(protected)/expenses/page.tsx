"use client";
import { RecordAttribution } from "@/features/audit/record-attribution";
import { FinancialAction, FinancialActionScope, FinancialInput, FinancialMessage, FinancialText, FinancialValue  } from "@/features/finance/financial-privacy";

import { FinancialAmount } from "@/components/ui/financial-amount";
import { eligibleExpenseAccounts, expenseDraftAmounts, expenseQueues, expenseStatusHelp, expenseStatusLabel, type ExpenseQueue } from "@/features/expenses/workspace-presentation";
import styles from "@/features/expenses/workspace.module.css";
import { useExpenseAccess } from "@/features/expenses/use-expense-access";
import { defaultExpenseScope, expenseScopeKey, expenseScopeFromKey, hasExpenseScope, type ExpenseScope } from "@/features/expenses/expense-access";
import { ProviderFunds } from "@/features/accounting/provider-funds";

import { CheckCircle2, HandCoins, RefreshCw, Send } from "lucide-react";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { firstBlocker } from "@/features/guidance/first-blocker";
import { callAdministration } from "@/features/administration/api";
import { useAuth } from "@/features/auth/auth-context";
import { formatNaira, nairaToKobo } from "@/features/inventory/format";
import { canSelfAuthorize, hasPermission } from "@/lib/permissions/roles";
import type { OperatingExpense } from "@/types/domain";

interface Workspace {
  categories: Array<{ id: string; name: string; code: string }>;
  branches: Array<{ id: string; name: string; code: string }>;
  warehouses: Array<{ id: string; name: string; code: string }>;
  expenses: Array<OperatingExpense & { submittedBy?: string; approvedBy?: string; notes?: string }>;
  nextCursor?: string | null;
  scannedCount?: number;
  lookupNextCursors?: Partial<Record<ChoiceKind, string | null>>;
  bankAccounts: BankAccountOption[];
}
type ChoiceKind = "categories" | "branches" | "warehouses" | "bankAccounts";
interface ExpenseFilters { status: ExpenseQueue; search: string; fromDate: string; toDate: string }
const emptyFilters: ExpenseFilters = { status: "all", search: "", fromDate: "", toDate: "" };
interface BankAccountOption {
  branchId?: string | null;
  id: string;
  bankName: string;
  accountName: string;
  accountNumberLast4: string;
  ledgerAccountCode: string;
}
type PaymentMethod = "cash" | "card" | "bank_transfer";
interface PaymentDraft {
  amountNaira: string;
  method: PaymentMethod;
  reference: string;
  bankAccountId: string;
}

function localDate() {
  const date = new Date(),
    offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}
function minorOrNaN(value: string) {
  try { return nairaToKobo(Number(value)); } catch { return Number.NaN; }
}

export default function ExpensesPage() {
  const { user, profile } = useAuth();
  return <Suspense fallback={<p role="status">Loading expenses…</p>}><ExpensesWorkspace key={`${profile?.organizationId}:${user?.uid || "signed-out"}`} /></Suspense>;
}

function ExpensesWorkspace() {
  const params = useSearchParams();
  const linkedCaseId = params.get("caseId") || "";
  const linkedSaleId = params.get("saleId") || "";
  const linkedBranchId = params.get("branchId") || "";
  const linkedId = linkedCaseId || linkedSaleId;
  const { user, profile, operatingContext } = useAuth();
  const storageKey = `abr-pending-expense:${profile?.organizationId}:${user?.uid}`;
  const [pending, setPending] = useState<{ name: string; input: Record<string, unknown> } | null>(null);
  const [ready, setReady] = useState(false);
  const mutationFlight = useRef(false);
  const { identity, access, error: accessError, loading: accessLoading } = useExpenseAccess();
  const [selectedScope, setSelectedScope] = useState<string | null>(null);
  const forcedScope: ExpenseScope | undefined = operatingContext ? operatingContext.type === "branch" ? { branchId: operatingContext.id } : { warehouseId: operatingContext.id }
    : linkedId ? { branchId: linkedBranchId } : undefined;
  const preferredScope = forcedScope ?? (selectedScope === null ? undefined : expenseScopeFromKey(selectedScope));
  const eligiblePreferredScope = forcedScope ?? (access && preferredScope && hasExpenseScope(access, preferredScope, "expenses.read") ? preferredScope : undefined);
  const readScope = access ? defaultExpenseScope(access, "expenses.read", eligiblePreferredScope) : null;
  const scopeValue = expenseScopeKey(readScope);
  const scopeIdentity = JSON.stringify([identity, scopeValue, access?.organizationPermissions]);
  const [filters, setFilters] = useState<ExpenseFilters>(emptyFilters);
  const [filterDraft, setFilterDraft] = useState<ExpenseFilters>(emptyFilters);
  const filterIdentity = JSON.stringify([scopeIdentity, filters]);
  const [navigation, setNavigation] = useState({ key: "", cursors: [""], index: 0 });
  const pages = navigation.key === filterIdentity ? navigation : { key: filterIdentity, cursors: [""], index: 0 };
  const cursor = pages.cursors[pages.index] ?? "";
  const requestIdentity = JSON.stringify([filterIdentity, cursor]);
  const [loadedWorkspace, setWorkspace] = useState<{ key: string; scope: string; data: Workspace } | null>(null);
  const workspace = access && loadedWorkspace?.key === requestIdentity ? loadedWorkspace.data : null;
  const allocationIdentity = useRef("");
  const loadSequence = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [payments, setPayments] = useState<Record<string, PaymentDraft>>({});
  const [form, setForm] = useState({
    categoryName: "",
    costPurpose: linkedCaseId ? "service" : linkedSaleId ? "logistics" : "",
    payeeName: "",
    supplierId: "",
    independentObligationReference: "",
    scopeType: "organization",
    scopeId: "",
    expenseDate: localDate(),
    dueDate: "",
    supplierDocumentNumber: "",
    description: "",
    netAmountNaira: "",
    vatAmountNaira: "0.00",
    notes: "",
  });
  const [suppliers, setSuppliers] = useState<Array<{ id: string; name: string; supplierType: string }>>([]), [supplierCursor, setSupplierCursor] = useState<string | null>(null);
  const loadSuppliers = useCallback(async (cursorId?: string) => { try { const page = await callAdministration<object, { providers: typeof suppliers; nextCursorId: string | null }>("getServiceBillingCase", { action: "providers", cursorId }); setSuppliers(current => cursorId ? [...new Map([...current, ...page.providers].map(item => [item.id, item])).values()] : page.providers); setSupplierCursor(page.nextCursorId); } catch (cause) { setError(cause instanceof Error ? cause.message : "Suppliers unavailable."); } }, []);
  useEffect(() => { if (profile) { const timer = window.setTimeout(() => void loadSuppliers(), 0); return () => window.clearTimeout(timer); } }, [profile, loadSuppliers]);
  const can = (permission: Parameters<typeof hasPermission>[1]) =>
    Boolean(access?.permissions.includes(permission));
  const canApproveOwnWork = Boolean(profile && canSelfAuthorize(profile));
  const linkedScopeMismatch = !!linkedId && !!operatingContext && (operatingContext.type !== "branch" || operatingContext.id !== linkedBranchId);
  const scopeBranchId = readScope?.branchId, scopeWarehouseId = readScope?.warehouseId;
  const readReady = Boolean(access && readScope);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = sessionStorage.getItem(storageKey);
        const instruction = saved ? JSON.parse(saved) : null;
        if (instruction && (!["createExpense", "submitExpense", "approveExpense", "recordExpensePayment"].includes(instruction.name) || !instruction.input || typeof instruction.input !== "object" || Array.isArray(instruction.input)))
          throw new Error("Invalid saved expense instructions");
        setPending(instruction);
        setReady(true);
      } catch { setReady(false); setError("Saved expense instructions could not be read. Restore browser storage before recording another bill."); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [storageKey]);

  const load = useCallback(async (resetChoices = false) => {
    if (!readReady) return;
    const sequence = ++loadSequence.current;
    setBusy(true); setError(null);
    try {
      const contextInput = { ...(scopeBranchId ? { branchId: scopeBranchId } : {}), ...(scopeWarehouseId ? { warehouseId: scopeWarehouseId } : {}) };
      const result = await callAdministration<object, Workspace>("getExpenseWorkspace", { ...contextInput, limit: 25,
        ...(filters.status !== "all" ? { status: filters.status } : {}), ...(filters.search ? { search: filters.search } : {}),
        ...(filters.fromDate ? { fromDate: filters.fromDate } : {}), ...(filters.toDate ? { toDate: filters.toDate } : {}), ...(cursor ? { cursor } : {}) });
      if (sequence !== loadSequence.current) return;
      setWorkspace(previous => {
        if (!previous || previous.scope !== scopeIdentity || resetChoices) return { key: requestIdentity, scope: scopeIdentity, data: result };
        const merged = { ...result };
        for (const kind of ["categories", "branches", "warehouses", "bankAccounts"] as const) {
          // Keep explicitly loaded choices across register navigation. Refresh reloads choices.
          Object.assign(merged, { [kind]: [...new Map([...previous.data[kind], ...result[kind]].map(item => [item.id, item])).values()] });
        }
        merged.lookupNextCursors = previous.data.lookupNextCursors ?? result.lookupNextCursors;
        return { key: requestIdentity, scope: scopeIdentity, data: merged };
      });
      const preferred = forcedScope ?? contextInput;
      const allocation = access ? defaultExpenseScope(access, "expenses.create", hasExpenseScope(access, preferred, "expenses.create") ? preferred : undefined) : null;
      const next = forcedScope ?? allocation;
      if (next && allocationIdentity.current !== scopeIdentity) { allocationIdentity.current = scopeIdentity; setForm(current => ({ ...current, scopeType: next.branchId ? "branch" : next.warehouseId ? "warehouse" : "organization", scopeId: next.branchId ?? next.warehouseId ?? "" })); }
    } catch (cause) {
      if (sequence === loadSequence.current) setError(cause instanceof Error ? cause.message : "Expense records could not be loaded.");
    } finally { if (sequence === loadSequence.current) setBusy(false); }
  // IDs and the server authority identity define the request; unrelated form edits must not reload it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readReady, scopeBranchId, scopeWarehouseId, scopeIdentity, requestIdentity, filters, cursor]);
  const invalidateLoad = useCallback(() => { loadSequence.current++; }, []);
  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => { window.clearTimeout(timeout); invalidateLoad(); };
  }, [load, invalidateLoad]);

  function applyFilters(next: ExpenseFilters) {
    setFilters(next); setFilterDraft(next); setNavigation({ key: "", cursors: [""], index: 0 });
  }
  async function loadChoices(kind: ChoiceKind) {
    const choiceCursor = workspace?.lookupNextCursors?.[kind];
    if (!choiceCursor || busy || mutationFlight.current) return;
    const sequence = ++loadSequence.current;
    setBusy(true); setError(null);
    try {
      const result = await callAdministration<object, { kind: ChoiceKind; items: Array<{ id: string }>; nextCursorId: string | null }>("getExpenseWorkspace", {
        view: "choices", choiceKind: kind, choiceCursor, ...(scopeBranchId ? { branchId: scopeBranchId } : {}), ...(scopeWarehouseId ? { warehouseId: scopeWarehouseId } : {}),
      });
      if (sequence !== loadSequence.current) return;
      setWorkspace(previous => previous?.key === requestIdentity ? { ...previous, data: { ...previous.data,
        [kind]: [...new Map([...previous.data[kind], ...result.items].map(item => [item.id, item])).values()],
        lookupNextCursors: { ...previous.data.lookupNextCursors, [kind]: result.nextCursorId },
      } as Workspace } : previous);
    } catch (cause) { if (sequence === loadSequence.current) setError(cause instanceof Error ? cause.message : "More choices could not be loaded."); }
    finally { if (sequence === loadSequence.current) setBusy(false); }
  }

  async function run(name: string, input: Record<string, unknown>, success: string) {
    if (mutationFlight.current || !ready) return false;
    mutationFlight.current = true;
    const retry = pending;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const instruction = retry ?? { name, input };
      sessionStorage.setItem(storageKey, JSON.stringify(instruction)); setPending(instruction);
      await callAdministration(instruction.name, instruction.input);
      sessionStorage.removeItem(storageKey); setPending(null);
      setMessage(success);
      await load();
      return true;
    } catch (cause) {
      const diagnostic = cause as { diagnosticCode?: string; code?: string };
      if (!retry && ["functions/invalid-argument", "functions/permission-denied", "functions/failed-precondition", "functions/not-found", "functions/already-exists"].includes(diagnostic.diagnosticCode ?? diagnostic.code ?? "")) {
        sessionStorage.removeItem(storageKey); setPending(null);
      }
      setError(
        cause instanceof Error
          ? cause.message
          : "The expense operation could not be completed.",
      );
      return false;
    } finally {
      mutationFlight.current = false;
      setBusy(false);
    }
  }
  async function createExpense() {
    const netAmountMinor = minorOrNaN(form.netAmountNaira), vatAmountMinor = minorOrNaN(form.vatAmountNaira || "0");
    if (!pending && (!Number.isSafeInteger(netAmountMinor) || netAmountMinor <= 0 || !Number.isSafeInteger(vatAmountMinor))) {
      setError("Enter valid positive net and non-negative VAT amounts with no more than two decimal places."); return;
    }
    const scope =
      linkedId ? { branchId: linkedBranchId } : form.scopeType === "branch" ? { branchId: form.scopeId } : form.scopeType === "warehouse" ? { warehouseId: form.scopeId } : {};
    const success = await run("createExpense", {
          categoryName: form.categoryName,
          payeeName: form.payeeName,
          supplierId: form.supplierId || undefined,
          independentObligationReference: form.independentObligationReference || undefined,
          costPurpose: form.costPurpose || undefined,
          costReferenceType: linkedId ? linkedCaseId ? "aftersales" : "sale" : undefined,
          costReferenceId: linkedId || undefined,
          ...scope,
          expenseDate: form.expenseDate,
          dueDate: form.dueDate || undefined,
          supplierDocumentNumber: form.supplierDocumentNumber || undefined,
          description: form.description,
          netAmountMinor,
          vatAmountMinor,
          notes: form.notes || undefined,
          idempotencyKey: crypto.randomUUID(),
        }, "Draft bill saved. Submit and approve it to recognize the cost; record actual provider payments separately.");
    if (!success) return;
    setForm((current) => ({
      ...current,
      categoryName: "",
      payeeName: "",
      supplierId: "",
      independentObligationReference: "",
      supplierDocumentNumber: "",
      description: "",
      netAmountNaira: "",
      vatAmountNaira: "0.00",
      notes: "",
      dueDate: "",
    }));
  }
  if (!profile || !hasPermission(profile, "expenses.read"))
    return (
      <div className="rounded-xl border bg-white p-6">
        Your roles do not include expense access.
      </div>
    );
  const formScope: ExpenseScope = form.scopeType === "branch" ? { branchId: form.scopeId } : form.scopeType === "warehouse" ? { warehouseId: form.scopeId } : {};
  const scopeOptions = (form.scopeType === "branch" ? workspace?.branches : workspace?.warehouses)?.filter(location =>
    hasExpenseScope(access, form.scopeType === "branch" ? { branchId: location.id } : { warehouseId: location.id }, "expenses.create")) ?? [];
  const readBranches = workspace?.branches.filter(location => hasExpenseScope(access, { branchId: location.id }, "expenses.read")) ?? [];
  const readWarehouses = workspace?.warehouses.filter(location => hasExpenseScope(access, { warehouseId: location.id }, "expenses.read")) ?? [];

  const draftAmounts = expenseDraftAmounts(form.netAmountNaira, form.vatAmountNaira);
  const filterDateError = filterDraft.fromDate && filterDraft.toDate && filterDraft.fromDate > filterDraft.toDate;
  return (
    <div className={`${styles.workspace} space-y-5`}>

      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-[var(--brand)]">
            Expense to payment
          </p>
          <h1 className="text-3xl font-semibold">Operating expenses</h1>
          <p className="text-[var(--muted)]">
            Record a bill once, state VAT separately, approve it within your
            assigned location, then record only the money actually paid. Every
            step remains auditable.
          </p>
        </div>
        <Button variant="outline" disabled={busy || !readReady} onClick={() => void load(true)} disabledReason={!readReady ? "Choose an assigned expense scope before refreshing." : undefined}>
          <RefreshCw className="mr-2 size-4" /> Refresh
        </Button>
      </header>
      {accessLoading && <p role="status">Checking expense access…</p>}
      {accessError && <p role="alert" className="text-red-800"><FinancialText>{accessError}</FinancialText></p>}
      {access && !readScope && <p role="alert">Choose an assigned store or ask an administrator to review your expense access.</p>}
      {access && <label className="block text-sm">Expense register scope<select aria-label="Expense register scope" value={scopeValue} disabled={Boolean(forcedScope) || busy || Boolean(pending)} onChange={event => setSelectedScope(event.target.value)} className="mt-1 block w-full rounded-lg border p-2 sm:max-w-md">
        {!readScope && <option value="">Choose assigned store</option>}
        {hasExpenseScope(access, {}, "expenses.read") && <option value="organization">Entire organization</option>}
        {readBranches.map(location => <option key={`branch:${location.id}`} value={`branch:${location.id}`}><FinancialText>{location.name}</FinancialText></option>)}
        {readWarehouses.map(location => <option key={`warehouse:${location.id}`} value={`warehouse:${location.id}`}><FinancialText>{location.name}</FinancialText> · warehouse</option>)}
      </select></label>}
      {error && (
        <div
          role="alert"
          className="rounded-xl bg-red-50 p-4 text-sm text-red-800"
        >
          <FinancialMessage>{error}</FinancialMessage>
        </div>
      )}
      {message && (
        <div
          role="status"
          className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900"
        >
          <FinancialMessage>{message}</FinancialMessage>
        </div>
      )}

      {pending && <div role="status" className="rounded-xl bg-amber-50 p-4"><p>An expense operation is unconfirmed. Retry the saved instructions before recording another bill or payment.</p><FinancialAction retry={Boolean(pending)}><Button disabled={busy || !ready} onClick={() => void run(pending.name, pending.input, "Saved expense operation confirmed.")}>Retry saved expense instructions</Button></FinancialAction></div>}
      {can("expenses.create") && (
        <FinancialActionScope><details open={Boolean(linkedId)} className="rounded-xl border bg-white p-5">
          <summary className="cursor-pointer text-lg font-semibold">
            Record a new operating bill
          </summary>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Type a new category or reuse an existing one. New categories are
            created automatically. Amounts are naira; kobo remains two decimal
            places.
          </p>
          <label className="my-3 block text-sm">Existing supplier / provider<select className="input ml-2" value={form.supplierId} disabled={busy || !!pending || !ready || !workspace} onChange={event => { const supplier = suppliers.find(item => item.id === event.target.value); setForm(current => ({ ...current, supplierId: supplier?.id ?? "", payeeName: supplier?.name ?? "" })); }}><option value="">Other payee (enter name)</option>{suppliers.map(supplier => <option key={supplier.id} value={supplier.id}><FinancialText>{supplier.name}</FinancialText> · <FinancialText>{supplier.supplierType}</FinancialText></option>)}</select></label>{supplierCursor && <Button variant="outline" onClick={() => void loadSuppliers(supplierCursor)}>Load more existing suppliers</Button>}
          {linkedId && <label className="my-3 block text-sm">Separate company obligation reference (only if independent of invoice provider funds)<input className="input block w-full" value={form.independentObligationReference} disabled={busy || !!pending || !ready || !workspace} onChange={event => setForm({ ...form, independentObligationReference: event.target.value })}/><span>A separate supplier document and this reference are required to recognize an additional company expense for a provider already paid through the invoice.</span></label>}
          {linkedId && <div className="my-3 rounded-xl border bg-blue-50 p-4"><strong>Linked <FinancialText>{linkedCaseId ? "aftersales service" : "sale / delivery"}</FinancialText> cost</strong><p>This records a provider bill, not a customer charge or bank transfer. The server verifies the related record and store. Do not enter delivery pass-through amounts already recorded as a liability.</p>{linkedScopeMismatch && <p role="alert">Switch to the original record&apos;s store before recording this cost.</p>}{linkedCaseId && <Link className="underline" href={`/aftersales?caseId=${encodeURIComponent(linkedCaseId)}`}>Return to service case</Link>}</div>}
          <fieldset disabled={busy || !!pending || !ready || !workspace} className="mt-4 grid gap-3 md:grid-cols-3">
            <label className="text-sm">Cost purpose<select value={form.costPurpose} onChange={event => setForm({ ...form, costPurpose: event.target.value })} className="mt-1 w-full rounded-lg border p-3"><option value="">General operating expense</option><option value="service">Service / outsourced technician</option><option value="logistics">Delivery / logistics provider</option></select></label>
            <label className="text-sm">
              Category
              <input
                list="expense-categories"
                value={form.categoryName}
                onChange={(event) =>
                  setForm({ ...form, categoryName: event.target.value })
                }
                placeholder="e.g. Electricity"
                className="mt-1 w-full rounded-lg border p-3"
              />
              <datalist id="expense-categories">
                {workspace?.categories.map((category) => (
                  <option key={category.id} value={category.name} />
                ))}
              </datalist>
            </label>
            <label className="text-sm">
              Payee
              {form.supplierId && <span className="block text-xs text-[var(--muted)]">Payee comes from the selected supplier. Choose Other payee only for a genuinely separate payee; purchasing staff maintain supplier identity.</span>}
              <input
                disabled={Boolean(form.supplierId)}
                value={form.payeeName}
                onChange={(event) =>
                  setForm({ ...form, payeeName: event.target.value })
                }
                placeholder="Business or person paid"
                className="mt-1 w-full rounded-lg border p-3"
              />
            </label>
            <label className="text-sm">
              Expense date
              <input
                type="date"
                value={form.expenseDate}
                onChange={(event) =>
                  setForm({ ...form, expenseDate: event.target.value })
                }
                className="mt-1 w-full rounded-lg border p-3"
              />
            </label>
            <label className="text-sm">
              Allocate to
              {(operatingContext || linkedId) && <span className="block text-xs text-[var(--muted)]">Allocation and location follow the authorized Working location or linked source record. Select the correct context before creating a separate expense; ask the assigned manager to review a source mismatch.</span>}
              <select
                value={form.scopeType}
                disabled={Boolean(operatingContext) || !!linkedId}
                onChange={(event) =>
                  setForm({
                    ...form,
                    scopeType: event.target.value,
                    scopeId: "",
                  })
                }
                className="mt-1 w-full rounded-lg border p-3"
              >
                {hasExpenseScope(access, {}, "expenses.create") && <option value="organization">Whole organization</option>}
                {workspace?.branches.some(location => hasExpenseScope(access, { branchId: location.id }, "expenses.create")) && <option value="branch">Store / Head Office</option>}
                {workspace?.warehouses.some(location => hasExpenseScope(access, { warehouseId: location.id }, "expenses.create")) && <option value="warehouse">Warehouse</option>}
              </select>
            </label>
            <label className="text-sm">Payment due date (optional)<input type="date" value={form.dueDate} onChange={event => setForm({ ...form, dueDate: event.target.value })} className="mt-1 w-full rounded-lg border p-3" /></label>
            {form.scopeType !== "organization" && (
              <label className="text-sm">
                Location
                <select
                  value={form.scopeId}
                  disabled={Boolean(operatingContext) || !!linkedId}
                  onChange={(event) =>
                    setForm({ ...form, scopeId: event.target.value })
                  }
                  className="mt-1 w-full rounded-lg border p-3"
                >
                  <option value="">Select location</option>
                  {scopeOptions.map((location) => (
                    <option key={location.id} value={location.id}>
                      <FinancialText>{location.name}</FinancialText>
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="text-sm">
              Invoice / receipt number (optional)
              <input
                value={form.supplierDocumentNumber}
                onChange={(event) =>
                  setForm({
                    ...form,
                    supplierDocumentNumber: event.target.value,
                  })
                }
                className="mt-1 w-full rounded-lg border p-3"
              />
            </label>
            <label className="text-sm">
              Net amount (₦)
              <FinancialInput><input
                type="number"
                min="0.01"
                step="0.01"
                value={form.netAmountNaira}
                onChange={(event) =>
                  setForm({ ...form, netAmountNaira: event.target.value })
                }
                className="mt-1 w-full rounded-lg border p-3"
              /></FinancialInput>
            </label>
            <label className="text-sm">
              VAT (₦)
              <FinancialInput><input
                type="number"
                min="0"
                step="0.01"
                value={form.vatAmountNaira}
                onChange={(event) =>
                  setForm({ ...form, vatAmountNaira: event.target.value })
                }
                className="mt-1 w-full rounded-lg border p-3"
              /></FinancialInput>
            </label>
            <label className="text-sm md:col-span-3">
              Description
              <textarea
                value={form.description}
                onChange={(event) =>
                  setForm({ ...form, description: event.target.value })
                }
                placeholder="What was purchased and why it was needed"
                className="mt-1 min-h-24 w-full rounded-lg border p-3"
              />
            </label>
          </fieldset>
          <div className={`${styles.amounts} mt-4 rounded-lg border p-3`} aria-live="polite">
            <p>Net <FinancialAmount tone="neutral"><FinancialValue>{draftAmounts ? formatNaira(draftAmounts.netMinor) : "—"}</FinancialValue></FinancialAmount></p>
            <p>VAT <FinancialAmount tone="neutral"><FinancialValue>{draftAmounts ? formatNaira(draftAmounts.vatMinor) : "—"}</FinancialValue></FinancialAmount></p>
            <p>Draft bill total <FinancialAmount tone="outflow"><FinancialValue>{draftAmounts ? formatNaira(draftAmounts.grossMinor) : "—"}</FinancialValue></FinancialAmount></p>
          </div>
          <p className="mt-2 text-sm text-[var(--muted)]">The total is a preview, not a payment. Invoice / receipt number records a reference; file attachments are not supported here.</p>
          <FinancialAction><Button
            className="mt-4"
            disabled={
              busy ||
              !!pending || !ready ||
              !hasExpenseScope(access, formScope, "expenses.create") || !workspace ||
              linkedScopeMismatch ||
              (!!linkedId && (!linkedBranchId || !form.costPurpose || Boolean(linkedCaseId && linkedSaleId))) ||
              form.categoryName.trim().length < 2 ||
              form.payeeName.trim().length < 2 ||
              form.description.trim().length < 3 ||
              !draftAmounts || !form.expenseDate ||
              (form.scopeType !== "organization" && !form.scopeId)
            }
            disabledReason={firstBlocker([
              [!!pending, "Retry the saved expense instructions before recording another bill."],
              [!ready, "Wait for the saved-instruction check; restore browser storage if it reports an error."],
              [!readScope, "Choose an assigned expense store or ask authorized staff to review access."],
              [!workspace, "Wait for this scope's expense records to load."],
              [!hasExpenseScope(access, formScope, "expenses.create"), "Choose a location where you can create expenses; reading does not grant creation access."],
              [linkedScopeMismatch, "Switch to the original record's store before creating this linked bill."],
              [!!linkedId && (!linkedBranchId || !form.costPurpose || Boolean(linkedCaseId && linkedSaleId)), "A linked bill needs one source record, its store and a service or logistics purpose."],
              [form.categoryName.trim().length < 2 || form.payeeName.trim().length < 2 || form.description.trim().length < 3, "Enter a category and payee (at least two characters), and a description (at least three characters)."],
              [!draftAmounts, "Enter a positive net amount and non-negative VAT, with at most two decimal places and a valid total."],
              [!form.expenseDate, "Choose the bill date; approval requires its accounting period to be open."],
              [form.scopeType !== "organization" && !form.scopeId, "Select the location responsible for this bill."],
            ])}
            onClick={() => void createExpense()}
          >
            <HandCoins className="mr-2 size-4" /> Create draft expense
          </Button></FinancialAction>
        </details></FinancialActionScope>
      )}

      <section className="rounded-xl border bg-white p-5">
        <h2 className="text-xl font-semibold">Expense register</h2>
        <p className="text-sm text-[var(--muted)]">
          Submitting freezes the evidence. Approval recognizes the expense and
          payable; payment is recorded separately.
        </p>
        <div role="group" aria-label="Expense queues" className="mt-4 flex flex-wrap gap-2">
          {expenseQueues.map(queue => <Button key={queue.value} variant={filters.status === queue.value ? "primary" : "outline"} aria-pressed={filters.status === queue.value} disabled={busy || !readReady} onClick={() => applyFilters({ ...filters, status: queue.value })}><FinancialText>{queue.label}</FinancialText></Button>)}
        </div>
        <form className={`${styles.filters} mt-4`} onSubmit={event => { event.preventDefault(); if (!filterDateError && !busy) applyFilters({ ...filterDraft, status: filters.status }); }}>
          <label className="text-sm">Find a bill<input type="search" maxLength={120} placeholder="Reference, payee, category or description" value={filterDraft.search} disabled={busy} onChange={event => setFilterDraft({ ...filterDraft, search: event.target.value })} className="mt-1 block w-full rounded-lg border p-3" /></label>
          <label className="text-sm">Bill date from<input type="date" value={filterDraft.fromDate} disabled={busy} onChange={event => setFilterDraft({ ...filterDraft, fromDate: event.target.value })} className="mt-1 block w-full rounded-lg border p-3" /></label>
          <label className="text-sm">Bill date to<input type="date" value={filterDraft.toDate} disabled={busy} onChange={event => setFilterDraft({ ...filterDraft, toDate: event.target.value })} className="mt-1 block w-full rounded-lg border p-3" /></label>
          <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy || !readReady || !!filterDateError} disabledReason={filterDateError ? "The last bill date must be on or after the first bill date." : undefined}>Apply filters</Button><Button type="button" variant="outline" disabled={busy} onClick={() => applyFilters(emptyFilters)}>Clear filters</Button></div>
        </form>
        <p className="mt-3 text-sm text-[var(--muted)]">Dates refer to the bill, not the payment date. Search checks the reference, payee, category, description and linked record. Results keep a stable record order. Each page checks up to 500 records; an empty page can still have Next. No organization-wide totals are inferred from this page.</p>
        {busy && <p role="status" className="mt-3 text-sm">Loading or confirming expense instructions…</p>}
        <div className="mt-4 space-y-3">
          {workspace?.expenses.map((expense, index) => {
            const draft = payments[expense.id] ?? {
              amountNaira: (expense.outstandingAmountMinor / 100).toFixed(2),
              method: "bank_transfer" as PaymentMethod,
              reference: "",
              bankAccountId: "",
            };
            const eligibleAccounts = eligibleExpenseAccounts(workspace.bankAccounts, expense);
            const selectedAccountEligible = eligibleAccounts.some(account => account.id === draft.bankAccountId);
            const paymentMinor = minorOrNaN(draft.amountNaira);
            const validPayment =
              Number.isSafeInteger(paymentMinor) &&
              paymentMinor > 0 &&
              paymentMinor <= expense.outstandingAmountMinor;
            return (
              <article key={expense.id} className="rounded-xl border p-4">
                <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <strong><FinancialText>{expense.expenseNumber}</FinancialText></strong>
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs capitalize">
                        <FinancialText>{expenseStatusLabel(expense.status)}</FinancialText>
                      </span>
                    </div>
                    <p className="text-sm text-[var(--muted)]">
                      <FinancialText>{expense.categoryName}</FinancialText> · <FinancialText>{expense.payeeName}</FinancialText> ·{" "}
                      <FinancialText>{expense.branchName ??
                        expense.warehouseName ??
                        "Whole organization"}</FinancialText>
                    </p>
                    <p className="mt-1 text-sm">Bill total <FinancialAmount tone="outflow"><FinancialValue>{formatNaira(expense.grossAmountMinor)}</FinancialValue></FinancialAmount> · {["approved", "partially_paid", "paid"].includes(expense.status) ? <>Outstanding <FinancialAmount tone={expense.outstandingAmountMinor > 0 ? "attention" : "neutral"}><FinancialValue>{formatNaira(expense.outstandingAmountMinor)}</FinancialValue></FinancialAmount></> : "Not posted or paid"}</p>
                  </div>
                </div>
                <FinancialActionScope><details open={index === 0} className="mt-3 border-t pt-3">
                  <summary className="min-h-11 cursor-pointer py-2 font-semibold">Bill details and actions · <FinancialText>{expense.expenseNumber}</FinancialText></summary>
                  <p className="mb-3 text-sm text-[var(--muted)]"><FinancialText>{expenseStatusHelp(expense.status)}</FinancialText></p>
                  <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
                  <div className="min-w-0">
                    <p className="text-sm">Bill date: <FinancialText>{expense.expenseDate || "Not recorded"}</FinancialText> · Invoice / receipt: <FinancialText>{expense.supplierDocumentNumber || "Not recorded"}</FinancialText></p>
                    <p className="mt-1 text-sm">
                      Net <FinancialValue>{formatNaira(expense.netAmountMinor)}</FinancialValue> + VAT{" "}
                      <FinancialValue>{formatNaira(expense.vatAmountMinor)}</FinancialValue> ={" "}
                      <strong className="finance-outflow"><FinancialValue>{formatNaira(expense.grossAmountMinor)}</FinancialValue></strong>
                    </p>
                    {["approved", "partially_paid", "paid"].includes(expense.status) && <p className="text-sm">Paid to date <FinancialAmount tone="outflow"><FinancialValue>{formatNaira(expense.grossAmountMinor - expense.outstandingAmountMinor)}</FinancialValue></FinancialAmount></p>}
                    <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-3"><div><dt className="font-semibold">Created by</dt><dd><RecordAttribution actors={expense.actorLabels} field="createdBy" userId={expense.createdBy} /></dd></div><div><dt className="font-semibold">Submitted by (recorded ID)</dt><dd className="break-all"><FinancialText>{expense.submittedBy ?? "Unknown (not recorded)"}</FinancialText></dd></div><div><dt className="font-semibold">Approved by</dt><dd><RecordAttribution actors={expense.actorLabels} field="approvedBy" userId={expense.approvedBy} /></dd></div></dl>
                    <p className="mt-1 text-sm"><FinancialText>{expense.description}</FinancialText></p>
                    {expense.dueDate && <p className="text-sm">Payment due: <FinancialText>{expense.dueDate}</FinancialText></p>}
                    {expense.costPurpose && <p className="mt-2 text-sm"><strong><FinancialText>{expense.costPurpose === "service" ? "Service provider cost" : "Logistics provider cost"}</FinancialText></strong><FinancialText>{expense.costReferenceLabel && ` · ${expense.costReferenceLabel}`}</FinancialText>{expense.costReferenceType === "aftersales" && expense.costReferenceId && <> · <Link className="underline" href={`/aftersales?caseId=${encodeURIComponent(expense.costReferenceId)}`}>Open service case</Link></>}</p>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {expense.status === "draft" && hasExpenseScope(access, expense, "expenses.create") && (
                      <FinancialAction><Button
                        disabled={busy || !!pending || !ready}
                        onClick={() =>
                          void run(
                            "submitExpense", {
                                expenseId: expense.id,
                                idempotencyKey: crypto.randomUUID(),
                              },
                            `${expense.expenseNumber} submitted for approval.`,
                          )
                        }
                      >
                        <Send className="mr-2 size-4" /> Submit
                      </Button></FinancialAction>
                    )}
                    {expense.status === "submitted" &&
                      hasExpenseScope(access, expense, "expenses.approve") &&
                      (expense.createdBy !== user?.uid ||
                        canApproveOwnWork) && (
                        <FinancialAction><Button
                          disabled={busy || !!pending || !ready}
                          onClick={() =>
                            void run(
                              "approveExpense", {
                                  expenseId: expense.id,
                                  idempotencyKey: crypto.randomUUID(),
                                },
                              `${expense.expenseNumber} approved and posted to accrued expenses.`,
                            )
                          }
                        >
                          <CheckCircle2 className="mr-2 size-4" /> Approve
                        </Button></FinancialAction>
                      )}
                    {expense.status === "submitted" &&
                      expense.createdBy === user?.uid &&
                      !canApproveOwnWork && (
                        <span className="text-xs text-amber-800">
                          This role requires another approver
                        </span>
                      )}
                  </div>
                  </div>
                  {!hasExpenseScope(access, expense, expense.status === "draft" ? "expenses.create" : expense.status === "submitted" ? "expenses.approve" : "expenses.pay") && expense.status !== "paid" && <p className="mt-2 text-sm text-[var(--muted)]">You can view this bill. Its next action requires authorized staff for this bill&apos;s location.</p>}
                {["approved", "partially_paid"].includes(expense.status) &&
                  hasExpenseScope(access, expense, "expenses.pay") && (
                    <div className={`${styles.payment} mt-4 border-t pt-4`}>
                      <FinancialInput><input
                        aria-label="Payment amount in naira"
                        type="number"
                        min="0.01"
                        max={(expense.outstandingAmountMinor / 100).toFixed(2)}
                        step="0.01"
                        value={draft.amountNaira}
                        onChange={(event) =>
                          setPayments({
                            ...payments,
                            [expense.id]: {
                              ...draft,
                              amountNaira: event.target.value,
                            },
                          })
                        }
                        className="rounded-lg border p-3"
                      /></FinancialInput>
                      <select
                        aria-label="Payment method"
                        value={draft.method}
                        onChange={(event) =>
                          setPayments({
                            ...payments,
                            [expense.id]: {
                              ...draft,
                              method: event.target.value as PaymentMethod,
                              bankAccountId:
                                event.target.value === "cash"
                                  ? ""
                                  : draft.bankAccountId,
                            },
                          })
                        }
                        className="rounded-lg border p-3"
                      >
                        <option value="bank_transfer">Bank transfer</option>
                        <option value="card">Card / POS</option>
                        <option value="cash">Cash</option>
                      </select>
                      <select
                        aria-label="Company bank account"
                        value={draft.bankAccountId}
                        disabled={draft.method === "cash"}
                        onChange={(event) =>
                          setPayments({
                            ...payments,
                            [expense.id]: {
                              ...draft,
                              bankAccountId: event.target.value,
                            },
                          })
                        }
                        className="rounded-lg border p-3 disabled:bg-slate-100"
                      >
                        <option value="">
                          <FinancialText>{draft.method === "cash"
                            ? "Cash on hand"
                            : "Select bank account"}</FinancialText>
                        </option>
                        {eligibleAccounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            <FinancialText>{account.bankName}</FinancialText> · <FinancialText>{account.accountName}</FinancialText> · ••••
                            <FinancialText>{account.accountNumberLast4}</FinancialText> · <FinancialText>{account.branchId ? "Bill store" : "Company-wide"}</FinancialText>
                          </option>
                        ))}
                      </select>
                      <input
                        aria-label="Payment reference"
                        value={draft.reference}
                        onChange={(event) =>
                          setPayments({
                            ...payments,
                            [expense.id]: {
                              ...draft,
                              reference: event.target.value,
                            },
                          })
                        }
                        placeholder={
                          draft.method === "cash"
                            ? "Reference (optional)"
                            : "Payment reference"
                        }
                        className="rounded-lg border p-3"
                      />
                      <FinancialAction><Button aria-busy={busy} disabledReason={pending ? "Retry the saved expense payment instructions before recording another payment." : firstBlocker([
                        [!ready, "Wait for the saved expense-instruction check; review the displayed storage error if it cannot finish."],
                        [!validPayment, `Enter a positive actual payment with no more than two decimal places, within the displayed expense outstanding. Do not record the same payment twice.`],
                        [draft.method !== "cash" && !draft.reference.trim(), "Enter the actual noncash payment reference."],
                        [draft.method !== "cash" && !selectedAccountEligible, eligibleAccounts.length ? "Select an eligible account for this bill: its own store or company-wide. Record only the account actually used." : "No eligible paying account is loaded. Load more account choices below if available, or ask finance staff to configure an active account for this store or company-wide; cash is only for an actual cash payment."]
                      ])}
                        disabled={
                          busy ||
                          !!pending || !ready ||
                          !validPayment ||
                          (draft.method !== "cash" && !draft.reference.trim()) ||
                          (draft.method !== "cash" && !selectedAccountEligible)
                        }
                        onClick={() =>
                          void run(
                            "recordExpensePayment", {
                                expenseId: expense.id,
                                method: draft.method,
                                amountMinor: nairaToKobo(
                                  Number(draft.amountNaira),
                                ),
                                reference: draft.reference || undefined,
                                bankAccountId:
                                  draft.bankAccountId || undefined,
                                paidAt: new Date().toISOString(),
                                idempotencyKey: crypto.randomUUID(),
                              },
                            `Payment recorded against ${expense.expenseNumber}.`,
                          )
                        }
                      >
                        Record payment
                      </Button></FinancialAction>
                    </div>
                  )}
                  {["approved", "partially_paid"].includes(expense.status) && hasExpenseScope(access, expense, "expenses.pay") && <p className="mt-2 text-xs text-[var(--muted)]">Bank/card: use the bill&apos;s store account or a company-wide account. Organization and warehouse bills require a company-wide account. Closed periods and current server checks still apply.</p>}
                </details></FinancialActionScope>
              </article>
            );
          })}
          {workspace && !workspace.expenses.length && (
            <p className="rounded-lg bg-slate-50 p-6 text-center text-sm text-[var(--muted)]">
              <FinancialText>{workspace.nextCursor ? "No matching bills on this page. Continue with Next to check more records." : "No matching bills on this page. Clear filters or return to the first page to review this scope."}</FinancialText>
            </p>
          )}
        </div>
        <nav aria-label="Expense pages" className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant="outline" disabled={busy || pages.index === 0} onClick={() => setNavigation({ ...pages, index: 0 })}>First page</Button>
          <Button variant="outline" disabled={busy || pages.index === 0} onClick={() => setNavigation({ ...pages, index: pages.index - 1 })}>Previous</Button>
          <p role="status" className="text-sm">Page <FinancialText>{pages.index + 1}</FinancialText> · <FinancialText>{workspace?.expenses.length ?? 0}</FinancialText> bills shown<FinancialText>{workspace?.scannedCount !== undefined ? ` · ${workspace.scannedCount} records checked` : ""}</FinancialText></p>
          <Button variant="outline" disabled={busy || !workspace?.nextCursor} onClick={() => { if (workspace?.nextCursor) setNavigation({ key: filterIdentity, cursors: [...pages.cursors.slice(0, pages.index + 1), workspace.nextCursor], index: pages.index + 1 }); }}>Next</Button>
        </nav>
      </section>
      {workspace?.lookupNextCursors && Object.values(workspace.lookupNextCursors).some(Boolean) && <section className="rounded-xl border bg-white p-4"><h2 className="font-semibold">More available choices</h2><p className="mt-1 text-sm text-[var(--muted)]">If a location, category or paying account is missing, continue loading choices. An empty choice page can still have more. Refresh reloads the bill register and choices.</p><div className="mt-3 flex flex-wrap gap-2">{(["categories", "branches", "warehouses", "bankAccounts"] as const).filter(kind => workspace.lookupNextCursors?.[kind]).map(kind => <Button key={kind} variant="outline" disabled={busy} onClick={() => void loadChoices(kind)}>Load more <FinancialText>{kind === "bankAccounts" ? "bank accounts" : kind === "branches" ? "stores" : kind}</FinancialText></Button>)}</div></section>}
      {profile && user && workspace && hasPermission(profile, "expenses.read") && !scopeWarehouseId && <details className="rounded-xl border bg-white p-4"><summary className="min-h-11 cursor-pointer py-2 font-semibold">Invoice provider funds · separate from operating bills</summary><p className="my-3 text-sm text-[var(--muted)]">Use this section for invoice pass-through provider liabilities and their settlements. Do not record the same obligation again as an operating expense.</p><ProviderFunds ownerKey={`${profile.organizationId}:${user.uid}`} branchId={scopeBranchId} accounts={workspace.bankAccounts} canPay={Boolean(readScope && hasExpenseScope(access, readScope, "expenses.pay"))} canRecover={Boolean(readScope && hasExpenseScope(access, readScope, "expenses.pay") && hasExpenseScope(access, readScope, "finance.journal.reverse"))} /></details>}
    </div>
  );
}

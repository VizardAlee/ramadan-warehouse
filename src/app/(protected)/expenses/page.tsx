"use client";

import { ProviderFunds } from "@/features/accounting/provider-funds";

import { CheckCircle2, HandCoins, RefreshCw, Send } from "lucide-react";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import { useAuth } from "@/features/auth/auth-context";
import { formatNaira, nairaToKobo } from "@/features/inventory/format";
import { canSelfAuthorize, hasPermission } from "@/lib/permissions/roles";
import type { OperatingExpense } from "@/types/domain";

interface Workspace {
  categories: Array<{ id: string; name: string; code: string }>;
  branches: Array<{ id: string; name: string; code: string }>;
  warehouses: Array<{ id: string; name: string; code: string }>;
  expenses: OperatingExpense[];
  bankAccounts: BankAccountOption[];
}
interface BankAccountOption {
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
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
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
    Boolean(profile && hasPermission(profile, permission));
  const canApproveOwnWork = Boolean(profile && canSelfAuthorize(profile));
  const linkedScopeMismatch = !!linkedId && operatingContext?.type === "branch" && operatingContext.id !== linkedBranchId;
  const contextInput =
    operatingContext?.type === "branch"
      ? { branchId: operatingContext.id }
      : {};
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

  async function load() {
    if (!profile) return;
    setBusy(true);
    setError(null);
    try {
      const result = await callAdministration<
        { branchId?: string; warehouseId?: string },
        Workspace
      >("getExpenseWorkspace", contextInput);
      setWorkspace(result);
      if (linkedId && linkedBranchId) setForm(current => ({ ...current, scopeType: "branch", scopeId: linkedBranchId }));
      else if (operatingContext?.type === "branch")
        setForm((current) => ({
          ...current,
          scopeType: operatingContext.type,
          scopeId: operatingContext.id,
        }));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Expense records could not be loaded.",
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timeout);
    // The selected operating context is the authoritative workspace boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, operatingContext?.type, operatingContext?.id, linkedId, linkedBranchId]);

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
      linkedId ? { branchId: linkedBranchId } : form.scopeType === "branch" ? { branchId: form.scopeId } : {};
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
  if (!profile || !can("expenses.read"))
    return (
      <div className="rounded-xl border bg-white p-6">
        Your roles do not include expense access.
      </div>
    );
  const scopeOptions =
    form.scopeType === "branch" ? (workspace?.branches ?? []) : [];

  return (
    <div className="space-y-5">
      {profile && user && workspace && hasPermission(profile, "expenses.read") && operatingContext?.type !== "warehouse" && <ProviderFunds ownerKey={`${profile.organizationId}:${user.uid}`} branchId={operatingContext?.type === "branch" ? operatingContext.id : undefined} accounts={workspace.bankAccounts} canPay={hasPermission(profile, "expenses.pay")} canRecover={hasPermission(profile, "finance.journal.reverse")} />}
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
        <Button variant="outline" disabled={busy} onClick={() => void load()}>
          <RefreshCw className="mr-2 size-4" /> Refresh
        </Button>
      </header>
      {error && (
        <div
          role="alert"
          className="rounded-xl bg-red-50 p-4 text-sm text-red-800"
        >
          {error}
        </div>
      )}
      {message && (
        <div
          role="status"
          className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900"
        >
          {message}
        </div>
      )}

      {pending && <div role="status" className="rounded-xl bg-amber-50 p-4"><p>An expense operation is unconfirmed. Retry the saved instructions before recording another bill or payment.</p><Button disabled={busy || !ready} onClick={() => void run(pending.name, pending.input, "Saved expense operation confirmed.")}>Retry saved expense instructions</Button></div>}
      {can("expenses.create") && (
        <details open className="rounded-xl border bg-white p-5">
          <summary className="cursor-pointer text-lg font-semibold">
            1. Record an operating expense
          </summary>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Type a new category or reuse an existing one. New categories are
            created automatically. Amounts are naira; kobo remains two decimal
            places.
          </p>
          <label className="my-3 block text-sm">Existing supplier / provider<select className="input ml-2" value={form.supplierId} onChange={event => { const supplier = suppliers.find(item => item.id === event.target.value); setForm(current => ({ ...current, supplierId: supplier?.id ?? "", payeeName: supplier?.name ?? "" })); }}><option value="">Other payee (enter name)</option>{suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name} · {supplier.supplierType}</option>)}</select></label>{supplierCursor && <Button variant="outline" onClick={() => void loadSuppliers(supplierCursor)}>Load more existing suppliers</Button>}
          {linkedId && <label className="my-3 block text-sm">Separate company obligation reference (only if independent of invoice provider funds)<input className="input block w-full" value={form.independentObligationReference} onChange={event => setForm({ ...form, independentObligationReference: event.target.value })}/><span>A separate supplier document and this reference are required to recognize an additional company expense for a provider already paid through the invoice.</span></label>}
          {linkedId && <div className="my-3 rounded-xl border bg-blue-50 p-4"><strong>Linked {linkedCaseId ? "aftersales service" : "sale / delivery"} cost</strong><p>This records a provider bill, not a customer charge or bank transfer. The server verifies the related record and store. Do not enter delivery pass-through amounts already recorded as a liability.</p>{linkedScopeMismatch && <p role="alert">Switch to the original record&apos;s store before recording this cost.</p>}{linkedCaseId && <Link className="underline" href={`/aftersales?caseId=${encodeURIComponent(linkedCaseId)}`}>Return to service case</Link>}</div>}
          <fieldset disabled={busy || !!pending || !ready} className="mt-4 grid gap-3 md:grid-cols-3">
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
                <option value="organization">Whole organization</option>
                <option value="branch">Store / Head Office</option>
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
                      {location.name}
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
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={form.netAmountNaira}
                onChange={(event) =>
                  setForm({ ...form, netAmountNaira: event.target.value })
                }
                className="mt-1 w-full rounded-lg border p-3"
              />
            </label>
            <label className="text-sm">
              VAT (₦)
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.vatAmountNaira}
                onChange={(event) =>
                  setForm({ ...form, vatAmountNaira: event.target.value })
                }
                className="mt-1 w-full rounded-lg border p-3"
              />
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
          <Button
            className="mt-4"
            disabled={
              busy ||
              !!pending || !ready ||
              linkedScopeMismatch ||
              (!!linkedId && (!linkedBranchId || !form.costPurpose || Boolean(linkedCaseId && linkedSaleId))) ||
              form.categoryName.trim().length < 2 ||
              form.payeeName.trim().length < 2 ||
              form.description.trim().length < 3 ||
              Number(form.netAmountNaira) <= 0 ||
              (form.scopeType !== "organization" && !form.scopeId)
            }
            onClick={() => void createExpense()}
          >
            <HandCoins className="mr-2 size-4" /> Create draft expense
          </Button>
        </details>
      )}

      <section className="rounded-xl border bg-white p-5">
        <h2 className="text-xl font-semibold">Expense register</h2>
        <p className="text-sm text-[var(--muted)]">
          Submitting freezes the evidence. Approval recognizes the expense and
          payable; payment is recorded separately.
        </p>
        <div className="mt-4 space-y-3">
          {workspace?.expenses.map((expense) => {
            const draft = payments[expense.id] ?? {
              amountNaira: (expense.outstandingAmountMinor / 100).toFixed(2),
              method: "bank_transfer" as PaymentMethod,
              reference: "",
              bankAccountId: "",
            };
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
                      <strong>{expense.expenseNumber}</strong>
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs capitalize">
                        {expense.status.replaceAll("_", " ")}
                      </span>
                    </div>
                    <p className="text-sm text-[var(--muted)]">
                      {expense.categoryName} · {expense.payeeName} ·{" "}
                      {expense.branchName ??
                        expense.warehouseName ??
                        "Whole organization"}
                    </p>
                    <p className="mt-1 text-sm">
                      Net {formatNaira(expense.netAmountMinor)} + VAT{" "}
                      {formatNaira(expense.vatAmountMinor)} ={" "}
                      <strong className="finance-outflow">{formatNaira(expense.grossAmountMinor)}</strong>
                    </p>
                    <p className="text-sm">
                      Outstanding <strong className={expense.outstandingAmountMinor > 0 ? "finance-attention" : "finance-neutral"}>{formatNaira(expense.outstandingAmountMinor)}</strong>
                    </p>
                    <p className="mt-1 text-sm">{expense.description}</p>
                    {expense.dueDate && <p className="text-sm">Payment due: {expense.dueDate}</p>}
                    {expense.costPurpose && <p className="mt-2 text-sm"><strong>{expense.costPurpose === "service" ? "Service provider cost" : "Logistics provider cost"}</strong>{expense.costReferenceLabel && ` · ${expense.costReferenceLabel}`}{expense.costReferenceType === "aftersales" && expense.costReferenceId && <> · <Link className="underline" href={`/aftersales?caseId=${encodeURIComponent(expense.costReferenceId)}`}>Open service case</Link></>}</p>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {expense.status === "draft" && can("expenses.create") && (
                      <Button
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
                      </Button>
                    )}
                    {expense.status === "submitted" &&
                      can("expenses.approve") &&
                      (expense.createdBy !== user?.uid ||
                        canApproveOwnWork) && (
                        <Button
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
                        </Button>
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
                {["approved", "partially_paid"].includes(expense.status) &&
                  can("expenses.pay") && (
                    <div className="mt-4 grid gap-2 border-t pt-4 md:grid-cols-2 xl:grid-cols-[10rem_11rem_minmax(14rem,1fr)_minmax(12rem,1fr)_auto]">
                      <input
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
                      />
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
                          {draft.method === "cash"
                            ? "Cash on hand"
                            : "Select bank account"}
                        </option>
                        {workspace.bankAccounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.bankName} · {account.accountName} · ••••
                            {account.accountNumberLast4}
                          </option>
                        ))}
                      </select>
                      <input
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
                      <Button
                        disabled={
                          busy ||
                          !!pending || !ready ||
                          !validPayment ||
                          (draft.method !== "cash" && !draft.reference.trim()) ||
                          (draft.method !== "cash" && !draft.bankAccountId)
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
                      </Button>
                    </div>
                  )}
              </article>
            );
          })}
          {!workspace?.expenses.length && (
            <p className="rounded-lg bg-slate-50 p-6 text-center text-sm text-[var(--muted)]">
              No operating expenses recorded for this context.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

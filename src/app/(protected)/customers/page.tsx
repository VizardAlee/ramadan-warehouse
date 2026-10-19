"use client";
import { FinancialAction, FinancialActionScope, FinancialAttributes, FinancialInput, FinancialMessage, FinancialText, FinancialValue  } from "@/features/finance/financial-privacy";

import {
  BadgeCheck,
  CreditCard,
  Plus,
  RefreshCw,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";
import { AccountReceiptButton } from "@/features/finance/account-receipt";
import { AccountPosition } from "@/features/finance/account-position";
import { MoneyTenderEditor, parseMoneyTenders, type MoneyTenderDraft } from "@/features/finance/money-tender-editor";
import { Button } from "@/components/ui/button";
import { firstBlocker } from "@/features/guidance/first-blocker";
import { AppDialog } from "@/components/ui/app-dialog";
import { CursorTablePagination } from "@/components/ui/table-pagination";
import { callAdministration } from "@/features/administration/api";
import { useOrganizationCollection } from "@/features/administration/use-organization-collection";
import { useAuth } from "@/features/auth/auth-context";
import { formatNaira, nairaToKobo } from "@/features/inventory/format";
import { FinancialAmount } from "@/components/ui/financial-amount";
import { customerHistoryLabel, customerHistoryTone, type CustomerHistory } from "@/features/customers/history-presentation";
import { useCustomerRegister, type CustomerSearchField } from "@/features/customers/use-customer-register";
import { hasPermission } from "@/lib/permissions/roles";
import type { Branch, Customer } from "@/types/domain";
import { CustomerReceivablesPanel, type OpenCustomerInvoice } from "@/features/customers/receivables-panel";

type CustomerAction = "create" | "edit" | "credit" | "payment";

const emptyForm = {
  name: "",
  phone: "",
  email: "",
  address: "",
  taxId: "",
  pricingTier: "retail" as "retail" | "wholesale",
  active: true,
};

export default function CustomersPage() {
  const { profile, accessProfile, operatingContext } = useAuth();
  const customers = useCustomerRegister();
  const branches = useOrganizationCollection<Branch>("branches");
  const [action, setAction] = useState<CustomerAction | null>(null);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [creditLimit, setCreditLimit] = useState("");
  const [creditDecision, setCreditDecision] = useState<
    "approve" | "suspend" | "reject"
  >("approve");
  const [reason, setReason] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [arrangementDraft, setArrangementDraft] = useState<{ id: string; name: string; active: boolean; reason: string } | null>(null);
  const [paymentAllocations, setPaymentAllocations] = useState([{ accountId: "general", amount: "" }]);
  const paymentRetryKey = useRef<string | null>(null);
  const paymentRetryPayload = useRef<Record<string, unknown> | null>(null);
  const [paymentSplit, setPaymentSplit] = useState(false);
  const [paymentParts, setPaymentParts] = useState<MoneyTenderDraft[]>([]);
  const [paymentUncertain, setPaymentUncertain] = useState(false);
  const [paymentPurpose, setPaymentPurpose] = useState<"repayment" | "advance" | "advance_refund">("repayment");
  const [paymentSource, setPaymentSource] = useState<"receipt" | "advance_balance">("receipt");
  const [paymentInvoice, setPaymentInvoice] = useState<OpenCustomerInvoice | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<
    "cash" | "card" | "bank_transfer"
  >("cash");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentBankAccountId, setPaymentBankAccountId] = useState("");
  const [manualBranchId, setManualBranchId] = useState("");
  const [search, setSearch] = useState("");
  const [searchField, setSearchField] = useState<CustomerSearchField>("name");
  const appliedSearch = useRef("name:");
  const [history, setHistory] = useState<CustomerHistory | null>(null);
  const historyRequest = useRef(0);
  const [expandedCustomerId, setExpandedCustomerId] = useState<string | null>(null);
  const historyLimit = 5;
  const [historyBranchId, setHistoryBranchId] = useState("");
  const [busy, setBusy] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canManage = Boolean(
    profile && hasPermission(profile, "customers.manage"),
  );
  const canApprove = Boolean(
    profile && hasPermission(profile, "customers.credit.approve"),
  );
  const canRecordPayment = Boolean(
    profile && hasPermission(profile, "customers.payment.record"),
  );
  const canRefundAdvance = Boolean(canRecordPayment && profile && hasPermission(profile, "sales.returns.approve"));
  const refundAdvance = paymentPurpose === "advance_refund";
  const contextBranchId =
    operatingContext?.type === "branch" ? operatingContext.id : "";
  const assignedBranchId =
    accessProfile?.branchIds.length === 1 ? accessProfile.branchIds[0]! : "";
  const activeBranches = branches.data.filter(
    (branch) => branch.status === "active",
  );
  const branchId =
    contextBranchId ||
    assignedBranchId ||
    manualBranchId ||
    activeBranches[0]?.id ||
    "";
  const initialHistoryBranchId = contextBranchId || assignedBranchId ||
    (profile && hasPermission(profile, "sales.read.all") ? "" : accessProfile?.branchIds[0] ?? "");
  const visible = customers.data;
  let paymentMinor = 0;
  try { paymentMinor = nairaToKobo(Number(paymentAmount)); } catch { /* submit explains invalid amounts */ }
  const splitResult = parseMoneyTenders(paymentParts, paymentMinor);
  const splitMoney = paymentSplit && paymentSource === "receipt";
  const validAdvanceRefund = !refundAdvance || (() => {
    if (!history || historyLoading || reason.trim().length < 5 || (!splitMoney && paymentMethod !== "cash" && paymentReference.trim().length < 3)) return false;
    try {
      const total = nairaToKobo(Number(paymentAmount));
      const allocations = paymentAllocations.map((item) => ({ accountId: item.accountId, amount: nairaToKobo(Number(paymentAllocations.length === 1 ? paymentAmount : item.amount)) }));
      return total > 0 && new Set(allocations.map((item) => item.accountId)).size === allocations.length && allocations.reduce((sum, item) => sum + item.amount, 0) === total && allocations.every((item) => item.amount > 0 && item.amount <= (history.customer.advanceBalances?.[item.accountId] ?? 0));
    } catch { return false; }
  })();
  useEffect(() => {
    const key = `${searchField}:${search.trim()}`;
    if (key === appliedSearch.current) return;
    const timer = window.setTimeout(() => {
      appliedSearch.current = key;
      customers.updateSearch(search, searchField);
    }, 300);
    return () => window.clearTimeout(timer);
    // The register owns its query state; only a changed search term starts a new page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, searchField]);

  function closeAction() {
    historyRequest.current += 1;
    setHistoryLoading(false);
    setAction(null);
    setSelected(null);
    setForm(emptyForm);
    setReason("");
    setCreditLimit("");
    setPaymentAmount("");
    setArrangementDraft(null);
    setPaymentAllocations([{ accountId: "general", amount: "" }]);
    setPaymentSplit(false); setPaymentParts([]); paymentRetryPayload.current = null;
    paymentRetryKey.current = null;
    setPaymentUncertain(false);
    setPaymentPurpose("repayment");
    setPaymentSource("receipt");
    setPaymentInvoice(null);
    setPaymentReference("");
    setPaymentBankAccountId("");
    setHistory(null);
  }

  function edit(customer: Customer) {
    setArrangementDraft(null);
    setSelected(customer);
    setForm({
      name: customer.name,
      phone: customer.phone ?? "",
      email: customer.email ?? "",
      address: customer.address ?? "",
      taxId: customer.taxId ?? "",
      pricingTier: customer.pricingTier ?? "retail",
      active: customer.active,
    });
    setAction("edit");
  }

  async function saveCustomer() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await callAdministration<
        Record<string, unknown>,
        { customerNumber: string }
      >("saveCustomer", {
        customerId: selected?.id,
        ...form,
        phone: form.phone || undefined,
        email: form.email || undefined,
        address: form.address || undefined,
        taxId: form.taxId || undefined,
        arrangement: arrangementDraft ?? undefined,
        idempotencyKey: crypto.randomUUID(),
      });
      closeAction();
      setMessage(
        `${result.customerNumber} saved. Credit remains unavailable until a system administrator approves a limit.`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The customer could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function decideCredit() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await callAdministration("decideCustomerCredit", {
        customerId: selected.id,
        decision: creditDecision,
        creditLimitMinor:
          creditDecision === "approve" ? nairaToKobo(Number(creditLimit)) : 0,
        reason,
        idempotencyKey: crypto.randomUUID(),
      });
      closeAction();
      setMessage(
        `${selected.name}'s credit authority was ${creditDecision === "approve" ? "approved" : creditDecision === "suspend" ? "suspended" : "rejected"}.`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The credit decision could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function recordPayment() {
    if (!selected || !branchId) return;
    if (paymentSource === "receipt" && !splitMoney && paymentMethod !== "cash" && !paymentBankAccountId) {
      setError(refundAdvance ? "Select the paying company account." : "Select the receiving company account.");
      return;
    }
    if (!paymentRetryPayload.current && splitMoney && splitResult.error) { setError(splitResult.error); return; }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const amountMinor = nairaToKobo(Number(paymentAmount));
      const allocations = paymentAllocations.map((item) => ({ accountId: item.accountId, amountMinor: nairaToKobo(Number(paymentAllocations.length === 1 ? paymentAmount : item.amount)) }));
      setPaymentUncertain(true);
      const result = await callAdministration<
        Record<string, unknown>,
        { paymentNumber: string }
      >("recordCustomerPayment", paymentRetryPayload.current ??= {
        customerId: selected.id,
        branchId,
        method: paymentMethod,
        purpose: paymentPurpose,
        source: paymentSource,
        invoiceAllocations: paymentInvoice ? [{ saleId: paymentInvoice.id, amountMinor }] : undefined,
        bankAccountId: paymentSource === "receipt" && !splitMoney && paymentMethod !== "cash" ? paymentBankAccountId : undefined,
        tenders: splitMoney ? splitResult.parts : undefined,
        amountMinor,
        allocations,
        reference: paymentReference || undefined,
        notes: refundAdvance ? reason.trim() : undefined,
        idempotencyKey: paymentRetryKey.current ??= crypto.randomUUID(),
      });
      closeAction();
      setMessage(
        `Account transaction ${result.paymentNumber} recorded with its balanced accounting entry.`,
      );
    } catch (cause) {
      const code = typeof cause === "object" && cause !== null && "diagnosticCode" in cause ? String(cause.diagnosticCode) : "";
      if (["functions/invalid-argument", "functions/failed-precondition", "functions/permission-denied", "functions/not-found", "functions/unauthenticated", "functions/aborted"].includes(code)) {
        paymentRetryKey.current = null; paymentRetryPayload.current = null;
        setPaymentUncertain(false);
      }
      setError(
        cause instanceof Error
          ? cause.message
          : "The payment could not be recorded.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function loadHistory(customer: Customer, limit = historyLimit, selectedBranchId = historyBranchId) {
    const requestId = ++historyRequest.current;
    setHistoryLoading(true);
    setError(null);
    setHistory(null);
    try {
      const result = await callAdministration<
        { customerId: string; branchId?: string; limit: number }, CustomerHistory
      >("getCustomerHistory", {
        customerId: customer.id,
        branchId: selectedBranchId || undefined,
        limit,
      });
      if (requestId === historyRequest.current) setHistory(result);
    } catch (cause) {
      if (requestId === historyRequest.current) setError(cause instanceof Error ? cause.message : "Customer history could not be loaded.");
    } finally {
      if (requestId === historyRequest.current) setHistoryLoading(false);
    }
  }

  function toggleHistory(customer: Customer) {
    if (expandedCustomerId === customer.id) {
      historyRequest.current += 1;
      setHistoryLoading(false);
      setExpandedCustomerId(null);
      return;
    }
    setExpandedCustomerId(customer.id);
    setHistory(null);
    setHistoryBranchId(initialHistoryBranchId);
    void loadHistory(customer, 5, initialHistoryBranchId);
  }

  function customerActions(customer: Customer, view: "desktop" | "compact") {
    return <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" aria-expanded={expandedCustomerId === customer.id} aria-controls={`customer-history-${view}-${customer.id}`} onClick={() => toggleHistory(customer)}><FinancialText>{expandedCustomerId === customer.id ? "Hide history" : "View history"}</FinancialText></Button>
      {canManage && <Button size="sm" variant="outline" onClick={() => edit(customer)}>Edit</Button>}
      {canApprove && <Button size="sm" variant="outline" onClick={() => {
        setSelected(customer);
        setCreditDecision(customer.creditStatus === "approved" ? "suspend" : "approve");
        setCreditLimit(String(customer.creditLimitMinor / 100 || ""));
        setAction("credit");
      }}><BadgeCheck className="mr-1 size-4" /> Credit</Button>}
      {canRecordPayment && customer.outstandingBalanceMinor > 0 && <Button size="sm" onClick={() => {
        setSelected(customer);
        setPaymentAmount(String(customer.outstandingBalanceMinor / 100));
        setPaymentAllocations([{ accountId: "general", amount: "" }]);
        paymentRetryKey.current = null;
        setPaymentUncertain(false);
        setPaymentPurpose("repayment"); setPaymentSource("receipt"); setPaymentInvoice(null);
        setAction("payment");
        setPaymentBankAccountId("");
        void loadHistory(customer, 1, branchId);
      }}><CreditCard className="mr-1 size-4" /> Payment</Button>}
      {canRecordPayment && customer.active && <Button size="sm" variant="outline" onClick={() => {
        setSelected(customer); setPaymentAmount(""); setPaymentAllocations([{ accountId: "general", amount: "" }]);
        paymentRetryKey.current = null; setPaymentUncertain(false); setPaymentPurpose("advance"); setPaymentSource("receipt"); setPaymentInvoice(null);
        setAction("payment"); setPaymentBankAccountId(""); void loadHistory(customer, 1, branchId);
      }}>Record deposit</Button>}
      {canRefundAdvance && <Button size="sm" variant="outline" onClick={() => {
        setSelected(customer); setPaymentAmount(""); setPaymentAllocations([{ accountId: "general", amount: "" }]);
        paymentRetryKey.current = null; setPaymentUncertain(false); setPaymentPurpose("advance_refund"); setPaymentSource("receipt"); setPaymentInvoice(null);
        setReason(""); setPaymentReference(""); setPaymentMethod("bank_transfer"); setAction("payment"); setPaymentBankAccountId(""); void loadHistory(customer, 1, branchId);
      }}>Refund advance</Button>}
    </div>;
  }

  function customerPreview(customer: Customer, view: "desktop" | "compact") {
    if (expandedCustomerId !== customer.id) return null;
    return <FinancialAttributes><section id={`customer-history-${view}-${customer.id}`} aria-label={`${customer.name} account history`} className="space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h3 className="font-semibold">Recent account activity</h3><p className="text-xs text-[var(--muted)]">A quick preview of recorded sales, returns and account entries.</p></div>
        <Link href={`/customers/${customer.id}`} className="inline-flex min-h-9 items-center rounded-lg border px-3 text-sm font-semibold text-[var(--brand)]">View full history →</Link>
      </div>
      <dl className="grid gap-2 rounded-lg bg-slate-50 p-3 text-xs sm:grid-cols-2">
        <div><dt className="text-[var(--muted)]">Phone</dt><dd className="font-medium"><FinancialText>{customer.phone || "Not provided"}</FinancialText></dd></div>
        <div><dt className="text-[var(--muted)]">Email</dt><dd className="break-all font-medium"><FinancialText>{customer.email || "Not provided"}</FinancialText></dd></div>
        <div><dt className="text-[var(--muted)]">Address</dt><dd className="font-medium"><FinancialText>{customer.address || "Not provided"}</FinancialText></dd></div>
        <div><dt className="text-[var(--muted)]">Tax ID</dt><dd className="font-medium"><FinancialText>{customer.taxId || "Not provided"}</FinancialText></dd></div>
      </dl>
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg bg-blue-50 p-3 text-xs">Credit limit<strong className="mt-1 block text-base finance-balance"><FinancialValue>{formatNaira(history?.customer.creditLimitMinor ?? customer.creditLimitMinor)}</FinancialValue></strong></div>
        <div className="rounded-lg bg-amber-50 p-3 text-xs">Outstanding<strong className="mt-1 block text-base finance-attention"><FinancialValue>{formatNaira(history?.customer.outstandingBalanceMinor ?? customer.outstandingBalanceMinor)}</FinancialValue></strong></div>
        <div className="rounded-lg bg-blue-50 p-3 text-xs">Available credit<strong className="mt-1 block text-base finance-balance"><FinancialValue>{formatNaira(history?.customer.availableCreditMinor ?? customer.availableCreditMinor)}</FinancialValue></strong></div>
      </div>
      {history && <AccountPosition party="customer" scope="Current balances across all stores" debt={history.customer.outstandingBalanceMinor} credit={Object.values(history.customer.advanceBalances ?? {}).reduce((sum, amount) => sum + amount, 0)} />}
      {historyLoading && <p role="status" className="text-sm text-[var(--muted)]">Loading customer activity…</p>}
      {error && !history && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800"><FinancialMessage>{error}</FinancialMessage></p>}
      <div className="space-y-2">
        {history?.rows.map((row) => <div key={row.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border p-3 text-sm">
          <div><strong className="capitalize"><FinancialValue>{`${customerHistoryLabel(row.kind, row.detail, row.invoiceAllocations)} · ${row.accountName ?? "General account"}${row.allocations?.length ? " — " + row.allocations.map((allocation) => `${allocation.accountName}: ${formatNaira(allocation.amountMinor)}`).join("; ") : ""}`}</FinancialValue></strong><p className="text-xs text-[var(--muted)]"><FinancialText>{row.reference}</FinancialText> · <FinancialText>{row.at ? new Date(row.at).toLocaleString("en-NG") : "Date pending"}</FinancialText></p></div>
          <div className="space-y-2"><FinancialAmount tone={customerHistoryTone(row.kind, row.detail)} className="font-semibold"><FinancialValue>{formatNaira(Math.abs(row.amountMinor))}</FinancialValue></FinancialAmount>{row.paymentId && <AccountReceiptButton party="customer" partyId={customer.id} paymentId={row.paymentId} branchId={row.branchId} />}</div>
        </div>)}
        {history && history.rows.length === 0 && <p className="rounded-lg bg-slate-50 p-3 text-sm text-[var(--muted)]">No recorded activity in this store.</p>}
      </div>
    </section></FinancialAttributes>;
  }

  if (!profile || !hasPermission(profile, "customers.read"))
    return (
      <div className="rounded-xl border bg-white p-6">
        Your roles do not include customer-account access.
      </div>
    );

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-[var(--brand)]">
            Sales accounts
          </p>
          <h1 className="text-3xl font-semibold">Customers &amp; credit</h1>
          <p className="text-[var(--muted)]">
            Create customer records, control credit authority, and record
            repayments without editing posted sales.
          </p>
        </div>
        {canManage && (
          <Button
            onClick={() => {
              setForm(emptyForm);
              setAction("create");
            }}
          >
            <Plus className="mr-2 size-4" /> Add customer
          </Button>
        )}
      </header>
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
      <section className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
        <label className="text-sm font-medium">Search by
          <select value={searchField} onChange={(event) => setSearchField(event.target.value as CustomerSearchField)} className="mt-1 w-full rounded-lg border p-3">
            <option value="name">Name</option><option value="number">Customer number</option><option value="phone">Phone</option><option value="email">Email</option>
          </select>
        </label>
        <label className="text-sm font-medium">Find customer
          <input value={search} onChange={(event) => setSearch(event.target.value)} className="mt-1 w-full rounded-lg border p-3" placeholder={`Start typing a ${searchField === "number" ? "customer number" : searchField}`} />
        </label>
        <p className="text-xs text-[var(--muted)] sm:col-span-2">Search matches the beginning of the selected field; results load one page at a time.</p>
      </section>
      {customers.error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800"><FinancialMessage>{customers.error}</FinancialMessage></p>}
      <section className="grid gap-4 md:grid-cols-2 lg:hidden">
        {visible.map((customer) => (
          <article key={customer.id} className="rounded-xl border bg-white p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold"><FinancialText>{customer.name}</FinancialText></h2>
                <p className="font-mono text-xs text-[var(--muted)]">
                  <FinancialText>{customer.customerNumber}</FinancialText>
                </p>
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${customer.creditStatus === "approved" ? "bg-emerald-100 text-emerald-800" : customer.creditStatus === "suspended" ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-700"}`}
              >
                <FinancialText>{customer.creditStatus}</FinancialText>
              </span>
            </div>
            <p className="mt-3 text-sm text-[var(--muted)]">
              <FinancialText>{customer.phone || customer.email || "No contact"}</FinancialText>
            </p>
            <dl className="mt-4 grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-3 text-sm">
              <div>
                <dt className="text-xs text-[var(--muted)]">Limit</dt>
                <dd className="font-semibold"><FinancialAmount tone="balance"><FinancialValue>{formatNaira(customer.creditLimitMinor)}</FinancialValue></FinancialAmount></dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--muted)]">Outstanding</dt>
                <dd className="font-semibold"><FinancialAmount tone={customer.outstandingBalanceMinor > 0 ? "attention" : "neutral"}><FinancialValue>{formatNaira(customer.outstandingBalanceMinor)}</FinancialValue></FinancialAmount></dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--muted)]">Available</dt>
                <dd className="font-semibold"><FinancialAmount tone="balance"><FinancialValue>{formatNaira(customer.availableCreditMinor)}</FinancialValue></FinancialAmount></dd>
              </div>
            </dl>
            <div className="mt-4"><FinancialText>{customerActions(customer, "compact")}</FinancialText></div>
            <FinancialText>{customerPreview(customer, "compact")}</FinancialText>
          </article>
        ))}
        {!customers.loading && visible.length === 0 && (
          <div className="col-span-full rounded-xl border bg-white p-8 text-center text-[var(--muted)]">
            No customers match. Add the customer once, then let a system
            administrator approve credit if required.
          </div>
        )}
      </section>
      <section className="hidden rounded-xl border bg-white lg:block" aria-label="Customer register">
        <div className="responsive-table-wrap">
          <table className="responsive-table min-w-[68rem] text-sm">
            <thead className="bg-slate-50"><tr>
              <th className="px-4 py-3">Customer</th><th className="px-4 py-3">Contact</th><th className="px-4 py-3">Credit status</th>
              <th className="px-4 py-3 text-right">Credit limit</th><th className="px-4 py-3 text-right">Outstanding</th><th className="px-4 py-3 text-right">Available credit</th><th className="px-4 py-3">Actions</th>
            </tr></thead>
            <tbody>
              {visible.map((customer) => <Fragment key={customer.id}>
                <tr className="border-t align-top">
                  <td className="px-4 py-3"><strong><FinancialText>{customer.name}</FinancialText></strong><span className="block font-mono text-xs text-[var(--muted)]"><FinancialText>{customer.customerNumber}</FinancialText></span></td>
                  <td className="max-w-48 break-words px-4 py-3"><FinancialText>{customer.phone || customer.email || "No contact"}</FinancialText></td>
                  <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${customer.creditStatus === "approved" ? "bg-emerald-100 text-emerald-800" : customer.creditStatus === "suspended" ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-700"}`}><FinancialText>{customer.creditStatus}</FinancialText></span></td>
                  <td className="px-4 py-3 text-right font-semibold"><FinancialAmount tone="balance"><FinancialValue>{formatNaira(customer.creditLimitMinor)}</FinancialValue></FinancialAmount></td>
                  <td className="px-4 py-3 text-right font-semibold"><FinancialAmount tone={customer.outstandingBalanceMinor > 0 ? "attention" : "neutral"}><FinancialValue>{formatNaira(customer.outstandingBalanceMinor)}</FinancialValue></FinancialAmount></td>
                  <td className="px-4 py-3 text-right font-semibold"><FinancialAmount tone="balance"><FinancialValue>{formatNaira(customer.availableCreditMinor)}</FinancialValue></FinancialAmount></td>
                  <td className="px-4 py-3"><FinancialText>{customerActions(customer, "desktop")}</FinancialText></td>
                </tr>
                {expandedCustomerId === customer.id && <tr className="border-t bg-slate-50/40"><td colSpan={7}><FinancialText>{customerPreview(customer, "desktop")}</FinancialText></td></tr>}
              </Fragment>)}
              {!customers.loading && visible.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-[var(--muted)]">No customers match this search.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      {customers.loading && <p role="status" className="text-sm text-[var(--muted)]">Loading customers…</p>}
      <CursorTablePagination page={customers.page} pageSize={customers.pageSize} rowCount={visible.length} hasNextPage={customers.hasNextPage} loading={customers.loading} onPrevious={customers.previousPage} onNext={customers.nextPage} onPageSizeChange={customers.updatePageSize} itemLabel="customers" />

      {action && (
        <AppDialog
          role="dialog"
          aria-modal="true"
          aria-label="Customer action"
        >
          <FinancialActionScope><section className="app-dialog-panel safe-bottom max-w-xl rounded-2xl bg-white p-5 shadow-2xl sm:p-6">
            <div className="flex items-center gap-3">
              <UserRound className="size-6 text-[var(--brand)]" />
              <h2 className="text-xl font-semibold">
                <FinancialText>{action === "create"
                  ? "Add customer"
                  : action === "edit"
                    ? "Edit customer"
                    : action === "credit"
                      ? "Administrator credit decision"
                    : refundAdvance ? "Refund unused customer advance" : paymentPurpose === "advance" ? "Record customer deposit" : "Record customer payment"}</FinancialText>
              </h2>
            </div>
            {(action === "create" || action === "edit") && (
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-medium sm:col-span-2">
                  Customer name
                  <input
                    value={form.name}
                    onChange={(event) =>
                      setForm({ ...form, name: event.target.value })
                    }
                    className="mt-1 w-full rounded-lg border p-3"
                  />
                </label>
                <label className="text-sm font-medium">
                  Phone (070 format)
                  <input
                    value={form.phone}
                    onChange={(event) =>
                      setForm({ ...form, phone: event.target.value })
                    }
                    className="mt-1 w-full rounded-lg border p-3"
                    placeholder="07012345678"
                  />
                </label>
                <label className="text-sm font-medium">
                  Email (optional)
                  <input
                    type="email"
                    value={form.email}
                    onChange={(event) =>
                      setForm({ ...form, email: event.target.value })
                    }
                    className="mt-1 w-full rounded-lg border p-3"
                  />
                </label>
                <label className="text-sm font-medium sm:col-span-2">
                  Address (optional)
                  <textarea
                    value={form.address}
                    onChange={(event) =>
                      setForm({ ...form, address: event.target.value })
                    }
                    className="mt-1 w-full rounded-lg border p-3"
                  />
                </label>
                <label className="text-sm font-medium">
                  Tax ID (optional)
                  <input
                    value={form.taxId}
                    onChange={(event) =>
                      setForm({ ...form, taxId: event.target.value })
                    }
                    className="mt-1 w-full rounded-lg border p-3"
                  />
                </label>
                <label className="text-sm font-medium">
                  Default price level
                  <select className="mt-1 w-full rounded-lg border p-3" value={form.pricingTier}
                    onChange={(event) => setForm({ ...form, pricingTier: event.target.value as "retail" | "wholesale" })}>
                    <option value="retail">Retail</option>
                    <option value="wholesale">Wholesale / dealer</option>
                  </select>
                  <span className="mt-1 block text-xs text-[var(--muted)]">POS uses wholesale where configured; this does not authorize credit.</span>
                </label>
                <label className="flex items-center gap-2 self-end pb-3 text-sm">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(event) =>
                      setForm({ ...form, active: event.target.checked })
                    }
                  />{" "}
                  Active customer
                </label>
                {action === "edit" && selected && <fieldset className="space-y-3 rounded-lg border p-3 sm:col-span-2">
                  <legend className="px-1 font-semibold">Account arrangements</legend>
                  <p className="text-xs text-[var(--muted)]">One customer, separate arrangements such as personal purchases or an installation project. Historical debt stays in General; all accounts share the customer’s credit limit.</p>
                  {(selected.arrangements ?? []).map((account) => <div key={account.id} className="flex flex-wrap items-center justify-between gap-2 text-sm"><span><FinancialText>{account.name}</FinancialText> · <FinancialText>{account.active ? "Active" : "Inactive"}</FinancialText> · <FinancialValue>{formatNaira(account.outstandingBalanceMinor)}</FinancialValue></span><Button size="sm" variant="outline" onClick={() => setArrangementDraft({ ...account, reason: "" })}>Edit arrangement</Button></div>)}
                  <Button size="sm" variant="outline" onClick={() => setArrangementDraft({ id: crypto.randomUUID(), name: "", active: true, reason: "" })}>Add arrangement</Button>
                  {arrangementDraft && <div className="space-y-3">
                    <label className="block text-sm">Arrangement name<input className="mt-1 w-full rounded-lg border p-3" value={arrangementDraft.name} onChange={(event) => setArrangementDraft({ ...arrangementDraft, name: event.target.value })} /></label>
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={arrangementDraft.active} onChange={(event) => setArrangementDraft({ ...arrangementDraft, active: event.target.checked })} />Active arrangement</label>
                    <label className="block text-sm">Reason for account change<textarea className="mt-1 w-full rounded-lg border p-3" value={arrangementDraft.reason} onChange={(event) => setArrangementDraft({ ...arrangementDraft, reason: event.target.value })} /></label>
                    <Button size="sm" variant="outline" onClick={() => setArrangementDraft(null)}>Discard account change</Button>
                  </div>}
                </fieldset>}
              </div>
            )}
            {action === "credit" && selected && (
              <div className="mt-5 space-y-4">
                <p className="rounded-lg bg-slate-50 p-3 text-sm">
                  <strong><FinancialText>{selected.name}</FinancialText></strong>
                  <br />
                  Outstanding: <FinancialValue>{formatNaira(selected.outstandingBalanceMinor)}</FinancialValue>
                </p>
                <label className="block text-sm font-medium">
                  Decision
                  <select
                    value={creditDecision}
                    onChange={(event) =>
                      setCreditDecision(
                        event.target.value as typeof creditDecision,
                      )
                    }
                    className="mt-1 w-full rounded-lg border p-3"
                  >
                    <option value="approve">Approve / change limit</option>
                    <option value="suspend">Suspend new credit</option>
                    <option value="reject">Reject credit</option>
                  </select>
                </label>
                {creditDecision === "approve" && (
                  <label className="block text-sm font-medium">
                    Credit limit (₦)
                    <FinancialInput><input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={creditLimit}
                      onChange={(event) => setCreditLimit(event.target.value)}
                      className="mt-1 w-full rounded-lg border p-3"
                    /></FinancialInput>
                  </label>
                )}
                <label className="block text-sm font-medium">
                  Decision reason
                  <textarea
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    className="mt-1 w-full rounded-lg border p-3"
                  />
                </label>
              </div>
            )}
            {action === "payment" && selected && (
              <fieldset disabled={busy || paymentUncertain} className="mt-5 space-y-4">
                {paymentUncertain && <p className="rounded-lg bg-amber-50 p-3 text-sm">Payment details are locked while the outcome is uncertain. Retry Record payment to confirm the same receipt. Do not start another payment for the same money.</p>}
                <p className="rounded-lg bg-slate-50 p-3 text-sm">
                  <strong><FinancialText>{selected.name}</FinancialText></strong>
                  <br />
                  Outstanding before payment:{" "}
                  <FinancialValue>{formatNaira(selected.outstandingBalanceMinor)}</FinancialValue>
                </p>
                <p className="rounded-lg bg-blue-50 p-3 text-sm"><FinancialText>{refundAdvance ? "Record money actually paid back to this customer from unused advances. This reduces the advance liability, not invoice debt, stock or sales revenue. Choose the store recording the outgoing payment. Advance balances belong to the customer across all stores." : paymentPurpose === "advance" ? "This is money received before a sale. It stays as a customer advance liability until applied—not sales income." : "Without an invoice selection, repayments clear historical unallocated debt first, then the oldest tracked invoices in this store and arrangement (up to 50 per receipt)."}</FinancialText></p>
                {refundAdvance && <p className="rounded-lg border p-3 text-sm">{historyLoading ? "Checking unused advance balances…" : <>Unused advances (all stores): <strong className="finance-balance"><FinancialValue>{formatNaira(Object.values(history?.customer.advanceBalances ?? {}).reduce((sum, amount) => sum + amount, 0))}</FinancialValue></strong>. Each selected arrangement must have enough unused advance.</>}</p>}
                {paymentPurpose === "repayment" && <>
                  <label className="block text-sm font-medium">Payment source<select className="mt-1 w-full rounded-lg border p-3" value={paymentSource} onChange={(event) => setPaymentSource(event.target.value as "receipt" | "advance_balance")}><option value="receipt">New cash / bank / card receipt</option><option value="advance_balance">Apply previously received advance</option></select></label>
                  {paymentSource === "advance_balance" && <p className="text-sm">Unused advances across all arrangements: <FinancialValue>{formatNaira(Object.values(history?.customer.advanceBalances ?? {}).reduce((sum, amount) => sum + amount, 0))}</FinancialValue>. Application uses the balance of each selected arrangement.</p>}
                  {paymentInvoice ? <div className="rounded-lg border p-3 text-sm">Paying <FinancialText>{paymentInvoice.reference}</FinancialText> · <FinancialText>{paymentInvoice.accountName}</FinancialText><Button size="sm" variant="outline" onClick={() => setPaymentInvoice(null)}>Use automatic allocation</Button></div> : <CustomerReceivablesPanel key={branchId} customerId={selected.id} branchId={branchId || undefined} onSelect={(invoice) => { setPaymentInvoice(invoice); setPaymentAllocations([{ accountId: invoice.accountId, amount: "" }]); setPaymentAmount(String(invoice.outstandingMinor / 100)); }} />}
                </>}
                {!contextBranchId && !assignedBranchId && (
                  <label className="block text-sm font-medium">
                    <FinancialText>{refundAdvance ? "Store recording the refund" : "Receiving branch"}</FinancialText>
                    <select
                      value={branchId}
                      onChange={(event) =>
                        setManualBranchId(event.target.value)
                      }
                      className="mt-1 w-full rounded-lg border p-3"
                    >
                      {activeBranches.map((branch) => (
                        <option key={branch.id} value={branch.id}>
                          <FinancialText>{branch.name}</FinancialText>
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="block text-sm font-medium">
                  <FinancialText>{refundAdvance ? "Amount refunded (₦)" : paymentSource === "advance_balance" ? "Amount to apply (₦)" : "Amount received (₦)"}</FinancialText>
                  <FinancialInput><input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={paymentAmount}
                    onChange={(event) => setPaymentAmount(event.target.value)}
                    className="mt-1 w-full rounded-lg border p-3"
                  /></FinancialInput>
                </label>
                {paymentSource === "receipt" && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={paymentSplit} onChange={event => { setPaymentSplit(event.target.checked); if (!paymentParts.length) setPaymentParts([{ id: "first", method: paymentMethod, amount: paymentAmount, bankAccountId: paymentBankAccountId, reference: paymentReference }]); }} />Split money across payment methods / accounts</label>}
                {splitMoney && <MoneyTenderEditor value={paymentParts} onChange={setPaymentParts} total={paymentMinor} branchId={branchId} banks={history?.bankAccounts ?? []} />}
                {paymentSource === "receipt" && !splitMoney && <label className="block text-sm font-medium">
                  Method
                  <select
                    value={paymentMethod}
                    onChange={(event) =>
                      setPaymentMethod(
                        event.target.value as typeof paymentMethod,
                      )
                    }
                    className="mt-1 w-full rounded-lg border p-3"
                  >
                    <option value="cash">Cash</option>
                    <option value="card">Card / POS terminal</option>
                    <option value="bank_transfer">Bank transfer</option>
                  </select>
                </label>}
                <fieldset disabled={Boolean(paymentInvoice)} className="space-y-3 rounded-lg border p-3"><legend className="px-1 font-semibold"><FinancialText>{refundAdvance ? "Refund from customer advances" : "Apply payment to customer accounts"}</FinancialText></legend>
                  <p className="text-xs text-[var(--muted)]"><FinancialText>{refundAdvance ? "Choose the arrangements whose unused advances are being returned." : paymentPurpose === "advance" ? "Choose the arrangement holding this advance." : "This allocates debt repayment between arrangements, not between cash/card/bank methods."}</FinancialText> Allocations must equal the total entered.</p>
                  {paymentAllocations.map((allocation, index) => <div key={index} className="space-y-2 rounded-lg bg-slate-50 p-2">
                    <label className="block text-sm">Customer account <FinancialText>{index + 1}</FinancialText><select className="mt-1 w-full rounded-lg border p-3" value={allocation.accountId} onChange={(event) => setPaymentAllocations((items) => items.map((item, position) => position === index ? { ...item, accountId: event.target.value } : item))}>
                      {(history?.customer.arrangements ?? [{ id: "general", name: "General account", outstandingBalanceMinor: selected.outstandingBalanceMinor }]).map((account) => <option key={account.id} value={account.id}><FinancialText>{account.name}</FinancialText> · <FinancialValue textOnly>{formatNaira(refundAdvance ? history?.customer.advanceBalances?.[account.id] ?? 0 : account.outstandingBalanceMinor)}</FinancialValue> <FinancialText>{refundAdvance ? "unused advance" : "due"}</FinancialText></option>)}
                    </select></label>
                    {paymentAllocations.length > 1 && <><label className="block text-sm">Allocated amount (₦)<FinancialInput><input className="mt-1 w-full rounded-lg border p-3" type="number" min="0.01" step="0.01" value={allocation.amount} onChange={(event) => setPaymentAllocations((items) => items.map((item, position) => position === index ? { ...item, amount: event.target.value } : item))} /></FinancialInput></label><Button size="sm" variant="outline" onClick={() => setPaymentAllocations((items) => items.filter((_, position) => position !== index))}>Remove allocation</Button></>}
                  </div>)}
                  <Button size="sm" variant="outline" disabled={paymentAllocations.length >= (history?.customer.arrangements?.length ?? 1)} onClick={() => setPaymentAllocations((items) => [...items.map((item) => ({ ...item, amount: items.length === 1 ? paymentAmount : item.amount })), { accountId: history?.customer.arrangements?.find((account) => !items.some((item) => item.accountId === account.id))?.id ?? "general", amount: "" }])}>Split across arrangements</Button>
                </fieldset>
                {paymentSource === "receipt" && !splitMoney && paymentMethod !== "cash" && (
                  <label className="block text-sm font-medium"><FinancialText>{refundAdvance ? "Paying company account" : "Receiving company account"}</FinancialText>
                    <select value={paymentBankAccountId} onChange={(event) => setPaymentBankAccountId(event.target.value)} className="mt-1 w-full rounded-lg border p-3">
                      <option value="">Select account</option>
                      {history?.bankAccounts?.filter(account => !account.branchId || account.branchId === branchId).map((account) => <option key={account.id} value={account.id}><FinancialText>{account.bankName}</FinancialText> · <FinancialText>{account.accountName}</FinancialText> · ••••<FinancialText>{account.accountNumberLast4}</FinancialText></option>)}
                    </select>
                    <span className="mt-1 block text-xs text-[var(--muted)]"><FinancialText>{historyLoading ? "Loading accounts…" : refundAdvance ? "This account pays the refund and is credited in the accounting journal." : "This account receives the money and is used in the accounting journal."}</FinancialText></span>
                  </label>
                )}
                {paymentSource === "receipt" && !splitMoney && paymentMethod !== "cash" && (
                  <label className="block text-sm font-medium">
                    <FinancialText>{refundAdvance ? "Actual refund reference" : "Reference (optional)"}</FinancialText>
                    <input
                      value={paymentReference}
                      onChange={(event) =>
                        setPaymentReference(event.target.value)
                      }
                      className="mt-1 w-full rounded-lg border p-3"
                    />
                  </label>
                )}
                {refundAdvance && <label className="block text-sm font-medium">Refund reason<textarea className="mt-1 w-full rounded-lg border p-3" value={reason} minLength={5} maxLength={500} onChange={(event) => setReason(event.target.value)} /></label>}
              </fieldset>
            )}
            <div className="sticky bottom-0 mt-6 flex justify-end gap-3 border-t bg-white pt-4">
              <Button variant="secondary" onClick={closeAction}>
                Cancel
              </Button>
              <FinancialAction financial={action === "credit" || action === "payment"} retry={() => action === "payment" && paymentUncertain && Boolean(paymentRetryPayload.current)}><Button aria-busy={busy} disabledReason={firstBlocker([
                [arrangementDraft && arrangementDraft.name.trim().length < 2, "Enter an account arrangement name of at least 2 characters."],
                [arrangementDraft && arrangementDraft.reason.trim().length < 5, "Enter the account-change reason, at least 5 characters."],
                [action === "credit" && reason.trim().length < 3, "Enter the administrator's credit-decision reason, at least 3 characters."],
                [action === "payment" && !branchId, "Select the real receiving/paying store. Ask an administrator if the correct assigned store is missing."],
                [action === "payment" && !paymentAmount, "Enter the actual positive payment/advance amount in naira."],
                [action === "payment" && refundAdvance && historyLoading, "Wait for customer advance evidence to load."],
                [action === "payment" && refundAdvance && reason.trim().length < 5, "Enter the advance-refund reason, at least 5 characters."],
                [action === "payment" && refundAdvance && !splitMoney && paymentMethod !== "cash" && paymentReference.trim().length < 3, "Enter the actual advance-refund reference, at least 3 characters."],
                [action === "payment" && splitMoney && Boolean(splitResult.error), splitResult.error ?? "Review payment parts."],
                [action === "payment" && !validAdvanceRefund, "Advance refund allocations must be unique positive amounts, total the refund exactly and stay within each arrangement's unused advance. Review the displayed available amounts; debt is separate."],
                [action === "payment" && paymentSource === "receipt" && !splitMoney && paymentMethod !== "cash" && !paymentBankAccountId, historyLoading ? "Wait for company accounts to load." : history?.bankAccounts?.length ? "Select the company account actually receiving/paying this money." : "No active company account is available. Ask authorized finance staff to configure it for this store, then refresh; cash is only for a real cash movement."]
              ])}
                disabled={
                  busy ||
                  Boolean(arrangementDraft && (arrangementDraft.name.trim().length < 2 || arrangementDraft.reason.trim().length < 5)) ||
                  (action === "credit" && reason.trim().length < 3) ||
                  (action === "payment" && (!paymentAmount || !branchId || !validAdvanceRefund || (splitMoney && Boolean(splitResult.error)) || (paymentSource === "receipt" && !splitMoney && paymentMethod !== "cash" && !paymentBankAccountId)))
                }
                onClick={() =>
                  void (action === "create" || action === "edit"
                    ? saveCustomer()
                    : action === "credit"
                      ? decideCredit()
                      : recordPayment())
                }
              >
                {busy ? (
                  <RefreshCw className="mr-2 size-4 animate-spin" />
                ) : null}
                <FinancialText>{action === "credit"
                  ? "Save decision"
                  : action === "payment"
                    ? refundAdvance ? "Record advance refund" : paymentPurpose === "advance" ? "Record deposit" : paymentSource === "advance_balance" ? "Apply advance" : "Record payment"
                    : "Save customer"}</FinancialText>
              </Button></FinancialAction>
            </div>
          </section></FinancialActionScope>
        </AppDialog>
      )}
    </div>
  );
}

"use client";

import { CheckCircle2, RotateCcw, Search, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import { useOrganizationCollection } from "@/features/administration/use-organization-collection";
import { useAuth } from "@/features/auth/auth-context";
import { formatNaira } from "@/features/inventory/format";
import { hasPermission } from "@/lib/permissions/roles";
import type { Branch, SaleReturn } from "@/types/domain";

interface ReturnWorkspace {
  sale: { id: string; saleNumber: string; receiptNumber: string; branchId: string; customerId: string | null; customerName: string | null; grossAmountMinor: number };
  items: Array<{ id: string; productId: string; sku: string; productName: string; unitOfMeasure: string; soldQuantity: number; returnedQuantity: number; returnableQuantity: number; unitPriceMinor: number; vatRateBasisPoints: number }>;
  openShifts: Array<{ id: string; deviceName: string; openedByName: string | null }>;
}
type Resolution = "cash" | "card" | "bank_transfer" | "customer_account" | "exchange_credit";

export default function ReturnsPage() {
  const { user, profile, accessProfile, operatingContext } = useAuth();
  const branches = useOrganizationCollection<Branch>("branches");
  const [manualBranchId, setManualBranchId] = useState("");
  const [receiptNumber, setReceiptNumber] = useState("");
  const [workspace, setWorkspace] = useState<ReturnWorkspace | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [conditions, setConditions] = useState<Record<string, "restockable" | "non_restockable">>({});
  const [resolution, setResolution] = useState<Resolution>("exchange_credit");
  const [refundShiftId, setRefundShiftId] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState<SaleReturn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const contextBranchId = operatingContext?.type === "branch" ? operatingContext.id : "";
  const assignedBranchId = accessProfile?.branchIds.length === 1 ? accessProfile.branchIds[0]! : "";
  const activeBranches = branches.data.filter((branch) => branch.status === "active");
  const branchId = contextBranchId || assignedBranchId || manualBranchId || activeBranches[0]?.id || "";
  const canCreate = Boolean(profile && hasPermission(profile, "sales.returns.create"));
  const canApprove = Boolean(profile && hasPermission(profile, "sales.returns.approve"));

  async function refreshPending() {
    if (!branchId || !profile) return;
    try {
      const result = await callAdministration<{ branchId: string; status: "submitted" }, { returns: SaleReturn[] }>("listSaleReturns", { branchId, status: "submitted" });
      setPending(result.returns);
    } catch { setPending([]); }
  }
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (!branchId || !profile) return;
      void callAdministration<{ branchId: string; status: "submitted" }, { returns: SaleReturn[] }>("listSaleReturns", { branchId, status: "submitted" })
        .then((result) => setPending(result.returns))
        .catch(() => setPending([]));
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [branchId, profile]);

  async function findSale() {
    if (!branchId || !receiptNumber.trim()) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const result = await callAdministration<{ branchId: string; receiptNumber: string }, ReturnWorkspace>("getSaleReturnWorkspace", { branchId, receiptNumber: receiptNumber.trim() });
      setWorkspace(result);
      setQuantities(Object.fromEntries(result.items.map((item) => [item.id, 0])));
      setConditions(Object.fromEntries(result.items.map((item) => [item.id, "restockable"])));
      setResolution(result.sale.customerId ? "customer_account" : "exchange_credit");
      setRefundShiftId(result.openShifts[0]?.id ?? "");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The receipt could not be loaded."); setWorkspace(null); }
    finally { setBusy(false); }
  }
  const selectedLines = useMemo(() => workspace?.items.filter((item) => (quantities[item.id] ?? 0) > 0) ?? [], [workspace, quantities]);
  const estimatedGross = selectedLines.reduce((sum, item) => {
    const net = (quantities[item.id] ?? 0) * item.unitPriceMinor;
    return sum + net + Math.round(net * item.vatRateBasisPoints / 10_000);
  }, 0);

  async function submitReturn() {
    if (!workspace || selectedLines.length === 0) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const result = await callAdministration<Record<string, unknown>, { returnNumber: string }>("createSaleReturn", {
        branchId, saleId: workspace.sale.id,
        lines: selectedLines.map((item) => ({ saleItemId: item.id, quantity: quantities[item.id], condition: conditions[item.id] })),
        resolution, refundShiftId: resolution === "cash" ? refundShiftId : undefined,
        reason, idempotencyKey: crypto.randomUUID(),
      });
      setWorkspace(null); setReceiptNumber(""); setReason("");
      setMessage(`${result.returnNumber} submitted. A different authorized manager must approve it before stock or money changes.`);
      await refreshPending();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The return could not be submitted."); }
    finally { setBusy(false); }
  }
  async function approve(record: SaleReturn) {
    setBusy(true); setError(null); setMessage(null);
    try {
      const result = await callAdministration<{ returnId: string; idempotencyKey: string }, { approved: boolean; creditId: string | null }>("approveSaleReturn", { returnId: record.id, idempotencyKey: crypto.randomUUID() });
      setMessage(`${record.returnNumber} approved and posted.${result.creditId ? " Its exchange credit is now available in POS." : ""}`);
      await refreshPending();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The return could not be approved."); }
    finally { setBusy(false); }
  }

  if (!profile || !hasPermission(profile, "sales.returns.read")) return <div className="rounded-xl border bg-white p-6">Your roles do not include sales-return access.</div>;
  return <div className="space-y-5">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[.16em] text-[var(--brand)]">Controlled corrections</p><h1 className="text-3xl font-semibold">Returns, refunds &amp; exchanges</h1><p className="text-[var(--muted)]">Start from the original receipt. Submission records the request; approval by another authorized person posts the correction.</p></div>{!contextBranchId && !assignedBranchId && <label className="text-sm font-medium">Branch<select value={branchId} onChange={(event) => { setManualBranchId(event.target.value); setWorkspace(null); }} className="mt-1 block min-h-11 min-w-56 rounded-lg border bg-white px-3">{activeBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>}</header>
    {error && <div role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</div>}{message && <div role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">{message}</div>}
    {canCreate && <section className="rounded-xl border bg-white p-5"><h2 className="flex items-center gap-2 text-xl font-semibold"><Search className="size-5" /> Find original sale</h2><p className="mt-1 text-sm text-[var(--muted)]">Use the official receipt number printed after checkout. Product and price details are reused automatically.</p><div className="mt-4 flex flex-col gap-3 sm:flex-row"><input value={receiptNumber} onChange={(event) => setReceiptNumber(event.target.value)} className="min-h-11 flex-1 rounded-lg border px-3" placeholder="RCT-IRB-2026-000001" /><Button disabled={busy || !branchId || !receiptNumber.trim()} onClick={() => void findSale()}>Load receipt</Button></div></section>}
    {workspace && <section className="rounded-xl border bg-white p-5"><div className="flex flex-wrap justify-between gap-3"><div><h2 className="text-xl font-semibold">{workspace.sale.receiptNumber}</h2><p className="text-sm text-[var(--muted)]">{workspace.sale.customerName || "Walk-in customer"} · original total {formatNaira(workspace.sale.grossAmountMinor)}</p></div><RotateCcw className="size-7 text-[var(--brand)]" /></div><div className="mt-5 space-y-3">{workspace.items.map((item) => <div key={item.id} className="grid gap-3 rounded-xl border p-4 md:grid-cols-[minmax(0,1fr)_8rem_12rem]"><div><strong>{item.productName}</strong><p className="font-mono text-xs text-[var(--muted)]">{item.sku}</p><p className="mt-1 text-sm">{item.returnableQuantity} of {item.soldQuantity} still returnable</p></div><label className="text-sm">Quantity<input type="number" min="0" max={item.returnableQuantity} value={quantities[item.id] ?? 0} onChange={(event) => setQuantities({ ...quantities, [item.id]: Math.min(item.returnableQuantity, Math.max(0, Number(event.target.value) || 0)) })} className="mt-1 w-full rounded-lg border p-2.5" /></label><label className="text-sm">Condition<select value={conditions[item.id] ?? "restockable"} onChange={(event) => setConditions({ ...conditions, [item.id]: event.target.value as "restockable" | "non_restockable" })} className="mt-1 w-full rounded-lg border p-2.5"><option value="restockable">Restockable</option><option value="non_restockable">Damaged / do not restock</option></select></label></div>)}</div><div className="mt-5 grid gap-4 md:grid-cols-2"><label className="text-sm font-medium">Resolution<select value={resolution} onChange={(event) => setResolution(event.target.value as Resolution)} className="mt-1 w-full rounded-lg border p-3"><option value="exchange_credit">Exchange credit for new POS sale</option><option value="cash">Cash refund</option><option value="card">Card/POS refund</option><option value="bank_transfer">Bank transfer refund</option>{workspace.sale.customerId && <option value="customer_account">Reduce customer receivable</option>}</select></label><label className="text-sm font-medium">Reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 w-full rounded-lg border p-3" placeholder="Why is the customer returning these goods?" /></label>{resolution === "cash" && <label className="text-sm font-medium">Refund from open till<select value={refundShiftId} onChange={(event) => setRefundShiftId(event.target.value)} className="mt-1 w-full rounded-lg border p-3"><option value="">Select open till</option>{workspace.openShifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.deviceName}{shift.openedByName ? ` · ${shift.openedByName}` : ""}</option>)}</select><span className="mt-1 block text-xs font-normal text-[var(--muted)]">The refund reduces this till&apos;s expected closing cash.</span></label>}</div><div className="mt-5 flex flex-col items-end gap-3 border-t pt-4"><p className="text-sm">Expected refund / credit: <strong>{formatNaira(estimatedGross)}</strong></p><Button disabled={busy || selectedLines.length === 0 || reason.trim().length < 5 || (resolution === "cash" && !refundShiftId)} onClick={() => void submitReturn()}>Submit return for independent approval</Button></div></section>}
    <section className="rounded-xl border bg-white p-5"><div className="flex items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 text-xl font-semibold"><ShieldCheck className="size-5" /> Awaiting approval</h2><p className="text-sm text-[var(--muted)]">The submitter cannot approve their own return.</p></div><Button variant="outline" onClick={() => void refreshPending()}>Refresh</Button></div><div className="mt-4 space-y-3">{pending.map((record) => <article key={record.id} className="flex flex-col justify-between gap-3 rounded-xl border p-4 sm:flex-row sm:items-center"><div><strong>{record.returnNumber}</strong><p className="text-sm text-[var(--muted)]">{record.receiptNumber} · {record.reason}</p><p className="mt-1 text-sm">{formatNaira(record.grossAmountMinor)} · {record.resolution.replaceAll("_", " ")}</p></div>{canApprove && record.createdBy !== user?.uid ? <Button disabled={busy} onClick={() => void approve(record)}><CheckCircle2 className="mr-2 size-4" /> Approve and post</Button> : <span className="text-xs text-amber-800">{record.createdBy === user?.uid ? "Another authorized user must approve" : "Approval permission required"}</span>}</article>)}{pending.length === 0 && <p className="rounded-lg bg-slate-50 p-6 text-center text-sm text-[var(--muted)]">No submitted returns are waiting at this branch.</p>}</div></section>
  </div>;
}

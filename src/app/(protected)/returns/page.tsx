"use client";

import { CheckCircle2, RotateCcw, Search, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import { useOrganizationCollection } from "@/features/administration/use-organization-collection";
import { useAuth } from "@/features/auth/auth-context";
import { formatNaira } from "@/features/inventory/format";
import { canSelfAuthorize, hasPermission } from "@/lib/permissions/roles";
import type { Branch, SaleReturn } from "@/types/domain";
import { ReturnFollowUp } from "@/features/returns/return-follow-up";
import { SaleCorrections } from "@/features/returns/sale-corrections";
import { CursorTablePagination } from "@/components/ui/table-pagination";

interface ReturnWorkspace {
  bankAccounts: Array<{ id: string; bankName: string; accountName: string; accountNumberLast4: string }>;
  sale: {
    id: string;
    saleNumber: string;
    receiptNumber: string;
    branchId: string;
    customerId: string | null;
    customerName: string | null;
    customerOutstandingMinor: number;
    grossAmountMinor: number;
  };
  items: Array<{
    id: string;
    productId: string;
    sku: string;
    productName: string;
    unitOfMeasure: string;
    soldQuantity: number;
    returnedQuantity: number;
    returnableQuantity: number;
    cancellableQuantity?: number;
    cancelledQuantity?: number;
    reversedNetAmountMinor?: number | null;
    reversedVatAmountMinor?: number | null;
    unitPriceMinor: number;
    vatRateBasisPoints: number;
    netAmountMinor: number;
    vatAmountMinor: number;
    grossAmountMinor: number;
  }>;
  openShifts: Array<{
    id: string;
    deviceName: string;
    openedByName: string | null;
  }>;
}
type Resolution =
  | "cash"
  | "card"
  | "bank_transfer"
  | "customer_account"
  | "exchange_credit";

export default function ReturnsPage() {
  const { user, profile, accessProfile, operatingContext } = useAuth();
  const branches = useOrganizationCollection<Branch>("branches");
  const [manualBranchId, setManualBranchId] = useState("");
  const [receiptNumber, setReceiptNumber] = useState("");
  const [workspace, setWorkspace] = useState<ReturnWorkspace | null>(null);
  const [showCorrections, setShowCorrections] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [kind, setKind] = useState<"goods_return" | "reservation_cancellation">("goods_return");
  const [conditions, setConditions] = useState<
    Record<string, "restockable" | "non_restockable">
  >({});
  const [resolution, setResolution] = useState<Resolution>("exchange_credit");
  const [refundShiftId, setRefundShiftId] = useState("");
  const [refundBankAccountId, setRefundBankAccountId] = useState("");
  const [bankAccounts, setBankAccounts] = useState<ReturnWorkspace["bankAccounts"]>([]);
  const [legacyRefundAccounts, setLegacyRefundAccounts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState<SaleReturn[]>([]);
  const [status, setStatus] = useState<"submitted" | "approved">("submitted");
  const [limit, setLimit] = useState(25);
  const [pages, setPages] = useState<Array<string | null>>([null]);
  const [pageBranchId, setPageBranchId] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [openShifts, setOpenShifts] = useState<Array<{ id: string; deviceName: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const submissionRetry = useRef<{ fingerprint: string; key: string } | null>(null);
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
  const scopedPages = pageBranchId === branchId ? pages : [null];
  const cursor = scopedPages.at(-1);
  const canCreate = Boolean(
    profile && hasPermission(profile, "sales.returns.create"),
  );
  const canApprove = Boolean(
    profile && hasPermission(profile, "sales.returns.approve"),
  );
  const canApproveOwnWork = Boolean(profile && canSelfAuthorize(profile));

  async function refreshPending() {
    if (!branchId || !profile) return;
    try {
      const result = await callAdministration<
        object,
        { returns: SaleReturn[]; bankAccounts: ReturnWorkspace["bankAccounts"]; nextCursor: string | null; openShifts: typeof openShifts }
      >("listSaleReturns", { branchId, status, limit, cursor: cursor || undefined });
      setPending(result.returns);
      setBankAccounts(result.bankAccounts ?? []);
      setNextCursor(result.nextCursor); setOpenShifts(result.openShifts ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Returns could not be loaded.");
    }
  }
  useEffect(() => {
    let active = true;
    const timeout = window.setTimeout(() => {
      if (!branchId || !profile) return;
      void callAdministration<
        object,
        { returns: SaleReturn[]; bankAccounts: ReturnWorkspace["bankAccounts"]; nextCursor: string | null; openShifts: typeof openShifts }
      >("listSaleReturns", { branchId, status, limit, cursor: cursor || undefined })
        .then((result) => { if (active) { setPending(result.returns); setBankAccounts(result.bankAccounts ?? []); setNextCursor(result.nextCursor); setOpenShifts(result.openShifts ?? []); } })
        .catch((cause) => { if (active) { setPending([]); setError(cause instanceof Error ? cause.message : "Returns could not be loaded."); } });
    }, 0);
    return () => { active = false; window.clearTimeout(timeout); };
  }, [branchId, profile, status, limit, cursor]);

  async function findSale() {
    if (!branchId || !receiptNumber.trim()) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await callAdministration<
        { branchId: string; receiptNumber: string },
        ReturnWorkspace
      >("getSaleReturnWorkspace", {
        branchId,
        receiptNumber: receiptNumber.trim(),
      });
      setWorkspace(result);
      setQuantities(
        Object.fromEntries(result.items.map((item) => [item.id, 0])),
      );
      setConditions(
        Object.fromEntries(
          result.items.map((item) => [item.id, "restockable"]),
        ),
      );
      setResolution("exchange_credit");
      setRefundShiftId(result.openShifts[0]?.id ?? "");
      setRefundBankAccountId("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The receipt could not be loaded.",
      );
      setWorkspace(null);
    } finally {
      setBusy(false);
    }
  }
  const selectedLines = useMemo(
    () =>
      workspace?.items.filter((item) => (quantities[item.id] ?? 0) > 0) ?? [],
    [workspace, quantities],
  );
  const estimatedGross = selectedLines.reduce((sum, item) => {
    const quantity = quantities[item.id] ?? 0;
    const previous = item.returnedQuantity + (item.cancelledQuantity ?? 0);
    return sum + Math.round(item.netAmountMinor * (previous + quantity) / item.soldQuantity)
      - (item.reversedNetAmountMinor ?? Math.round(item.netAmountMinor * previous / item.soldQuantity))
      + Math.round(item.vatAmountMinor * (previous + quantity) / item.soldQuantity)
      - (item.reversedVatAmountMinor ?? Math.round(item.vatAmountMinor * previous / item.soldQuantity));
  }, 0);

  async function submitReturn() {
    if (!workspace || selectedLines.length === 0) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const payload = {
        kind, branchId, saleId: workspace.sale.id,
        lines: selectedLines.map((item) => ({ saleItemId: item.id, quantity: quantities[item.id], condition: kind === "reservation_cancellation" ? "non_restockable" : conditions[item.id] })),
        resolution, refundShiftId: resolution === "cash" ? refundShiftId : undefined,
        bankAccountId: ["card", "bank_transfer"].includes(resolution) ? refundBankAccountId : undefined,
        reason,
      };
      const fingerprint = JSON.stringify(payload);
      if (submissionRetry.current?.fingerprint !== fingerprint)
        submissionRetry.current = { fingerprint, key: crypto.randomUUID() };
      const result = await callAdministration<
        Record<string, unknown>,
        { returnNumber: string }
      >("createSaleReturn", {
        ...payload,
        idempotencyKey: submissionRetry.current.key,
      });
      submissionRetry.current = null;
      setWorkspace(null);
      setReceiptNumber("");
      setReason("");
      setMessage(
        `${result.returnNumber} submitted. An authorized manager can now approve and post it.`,
      );
      await refreshPending();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The return could not be submitted.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function approve(record: SaleReturn) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await callAdministration<
        { returnId: string; idempotencyKey: string; bankAccountId?: string },
        { approved: boolean; creditId: string | null }
      >("approveSaleReturn", {
        returnId: record.id,
        bankAccountId: record.bankAccountId || legacyRefundAccounts[record.id] || undefined,
        idempotencyKey: crypto.randomUUID(),
      });
      setMessage(
        `${record.returnNumber} approved and posted.${result.creditId ? " Its exchange credit is now available in POS." : ""}`,
      );
      await refreshPending();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The return could not be approved.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!profile || !hasPermission(profile, "sales.returns.read"))
    return (
      <div className="rounded-xl border bg-white p-6">
        Your roles do not include sales-return access.
      </div>
    );
  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-[var(--brand)]">
            Controlled corrections
          </p>
          <h1 className="text-3xl font-semibold">
            Returns, refunds &amp; exchanges
          </h1>
          <p className="text-[var(--muted)]">
            Find the original receipt, inspect the goods, then approve the refund or exchange. Only items confirmed resellable go back into saleable stock.
          </p>
        </div>
        {!contextBranchId && !assignedBranchId && (
          <label className="text-sm font-medium">
            Branch
            <select
              value={branchId}
              onChange={(event) => {
                setManualBranchId(event.target.value);
                setWorkspace(null);
              }}
              className="mt-1 block min-h-11 min-w-56 rounded-lg border bg-white px-3"
            >
              {activeBranches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </label>
        )}
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
      {canCreate && (
        <section className="rounded-xl border bg-white p-5">
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            <Search className="size-5" /> Find original sale
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Enter the receipt or sale number. Product details and the amount actually charged, including any discount, are reused automatically.
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input
              value={receiptNumber}
              onChange={(event) => setReceiptNumber(event.target.value)}
              className="min-h-11 flex-1 rounded-lg border px-3"
              placeholder="RCT-IRB-2026-000001 or SAL-IRB-2026-000001"
            />
            <Button
              disabled={busy || !branchId || !receiptNumber.trim()}
              onClick={() => void findSale()}
            >
              Load receipt
            </Button>
          </div>
        </section>
      )}
      {workspace && (
        <section className="rounded-xl border bg-white p-5">
          <div className="flex flex-wrap justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">
                {workspace.sale.receiptNumber}
              </h2>
              <p className="text-sm text-[var(--muted)]">
                {workspace.sale.customerName || "Walk-in customer"} · original
                total {formatNaira(workspace.sale.grossAmountMinor)}
              </p>
            </div>
            <RotateCcw className="size-7 text-[var(--brand)]" />
          </div>
          <div className="mt-5 space-y-3">
            <label className="block text-sm font-medium">What happened?
              <select value={kind} onChange={(event) => { setKind(event.target.value as typeof kind); setQuantities({}); }} className="mt-1 w-full rounded-lg border p-3">
                <option value="goods_return">Return goods already collected</option>
                <option value="reservation_cancellation">Cancel goods not collected</option>
              </select>
            </label>
            {kind === "reservation_cancellation" && <p className="rounded-lg bg-blue-50 p-3 text-sm">These goods never left the store. Approval releases their reservation for sale again, without adding physical stock. Choose how the customer is refunded or their account adjusted.</p>}
            {workspace.items.map((item) => (
              <div
                key={item.id}
                className="grid gap-3 rounded-xl border p-4 md:grid-cols-[minmax(0,1fr)_8rem_12rem]"
              >
                <div>
                  <strong>{item.productName}</strong>
                  <p className="font-mono text-xs text-[var(--muted)]">
                    {item.sku}
                  </p>
                  <p className="mt-1 text-sm">
                    {kind === "reservation_cancellation" ? (item.cancellableQuantity ?? 0) : item.returnableQuantity} of {item.soldQuantity} {kind === "reservation_cancellation" ? "awaiting collection and cancellable" : "still returnable"}
                  </p>
                </div>
                <label className="text-sm">
                  Quantity
                  <input
                    type="number"
                    min="0"
                    max={kind === "reservation_cancellation" ? (item.cancellableQuantity ?? 0) : item.returnableQuantity}
                    value={quantities[item.id] ?? 0}
                    onChange={(event) =>
                      setQuantities({
                        ...quantities,
                        [item.id]: Math.min(
                          kind === "reservation_cancellation" ? (item.cancellableQuantity ?? 0) : item.returnableQuantity,
                          Math.max(0, Number(event.target.value) || 0),
                        ),
                      })
                    }
                    className="mt-1 w-full rounded-lg border p-2.5"
                  />
                </label>
                {kind === "goods_return" && <label className="text-sm">
                  Initial condition (inspection still required)
                  <select
                    value={conditions[item.id] ?? "restockable"}
                    onChange={(event) =>
                      setConditions({
                        ...conditions,
                        [item.id]: event.target.value as
                          | "restockable"
                          | "non_restockable",
                      })
                    }
                    className="mt-1 w-full rounded-lg border p-2.5"
                  >
                    <option value="restockable">Restockable</option>
                    <option value="non_restockable">
                      Damaged / do not restock
                    </option>
                  </select>
                </label>}
              </div>
            ))}
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="text-sm font-medium">
              Resolution
              <select
                value={resolution}
                onChange={(event) =>
                  setResolution(event.target.value as Resolution)
                }
                className="mt-1 w-full rounded-lg border p-3"
              >
                <option value="exchange_credit">
                  Exchange credit for new POS sale
                </option>
                <option value="cash">Cash refund</option>
                <option value="card">Card/POS refund</option>
                <option value="bank_transfer">Bank transfer refund</option>
                {workspace.sale.customerId && (
                  <option value="customer_account">
                    Reduce customer receivable (only if outstanding)
                  </option>
                )}
              </select>
              {resolution === "customer_account" && <span className="mt-1 block text-xs text-[var(--muted)]">Current customer receivable: {formatNaira(workspace.sale.customerOutstandingMinor)}. A larger return needs a refund or exchange credit instead.</span>}
            </label>
            <label className="text-sm font-medium">
              Reason
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className="mt-1 w-full rounded-lg border p-3"
                placeholder="Why is the customer returning these goods?"
              />
            </label>
            {["card", "bank_transfer"].includes(resolution) && <label className="text-sm font-medium">Refund from company account
              <select value={refundBankAccountId} onChange={(event) => setRefundBankAccountId(event.target.value)} className="mt-1 w-full rounded-lg border p-3">
                <option value="">Select funding account</option>
                {workspace.bankAccounts?.map((account) => <option key={account.id} value={account.id}>{account.bankName} · {account.accountName} · ••••{account.accountNumberLast4}</option>)}
              </select>
              <span className="mt-1 block text-xs text-[var(--muted)]">The refund is posted against this account, not the generic bank-clearing balance.</span>
            </label>}
            {resolution === "cash" && (
              <label className="text-sm font-medium">
                Refund from open till
                <select
                  value={refundShiftId}
                  onChange={(event) => setRefundShiftId(event.target.value)}
                  className="mt-1 w-full rounded-lg border p-3"
                >
                  <option value="">Select open till</option>
                  {workspace.openShifts.map((shift) => (
                    <option key={shift.id} value={shift.id}>
                      {shift.deviceName}
                      {shift.openedByName ? ` · ${shift.openedByName}` : ""}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-xs font-normal text-[var(--muted)]">
                  The refund reduces this till&apos;s expected closing cash.
                </span>
              </label>
            )}
          </div>
          <div className="mt-5 flex flex-col items-end gap-3 border-t pt-4">
            <p className="text-sm">
              Expected refund / credit:{" "}
              <strong>{formatNaira(estimatedGross)}</strong>
            </p>
            <Button
              disabled={
                busy ||
                selectedLines.length === 0 ||
                reason.trim().length < 5 ||
                (resolution === "customer_account" && estimatedGross > workspace.sale.customerOutstandingMinor) ||
                (resolution === "cash" && !refundShiftId) ||
                (["card", "bank_transfer"].includes(resolution) && !refundBankAccountId)
              }
              onClick={() => void submitReturn()}
            >
              {kind === "reservation_cancellation" ? "Submit cancellation for approval" : "Submit return for approval"}
            </Button>
          </div>
        </section>
      )}
      <section className="rounded-xl border bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-semibold">
              <ShieldCheck className="size-5" /> {status === "submitted" ? "Inspection & approval" : "Posted returns & exchange balances"}
            </h2>
            <p className="text-sm text-[var(--muted)]">
              Managers may approve their own branch return. Every decision is
              recorded in the audit trail.
            </p>
          </div>
          <Button variant="outline" onClick={() => void refreshPending()}>
            Refresh
          </Button>
        </div>
        <label className="mt-3 block text-sm">Show<select value={status} onChange={e => { setStatus(e.target.value as typeof status); setPages([null]); setPending([]); }} className="ml-2 rounded-lg border p-2"><option value="submitted">Awaiting inspection / approval</option><option value="approved">Posted returns and exchange credits</option></select></label>
        <div className="mt-4 space-y-3">
          {pending.map((record) => (
            <article
              key={record.id}
              className="flex flex-wrap justify-between gap-3 rounded-xl border p-4"
            >
              <div>
                <strong>{record.returnNumber}</strong>
                {record.kind === "reservation_cancellation" && <p className="text-sm font-medium">Cancellation of uncollected goods</p>}
                <p className="text-sm text-[var(--muted)]">
                  {record.receiptNumber} · {record.reason}
                </p>
                <p className="mt-1 text-sm">
                  {formatNaira(record.grossAmountMinor)} ·{" "}
                  {record.resolution.replaceAll("_", " ")}
                </p>
                {record.kind !== "reservation_cancellation" && <p className="mt-1 text-sm">{record.inspectionStatus === "completed" ? "Inspection recorded" : record.status === "approved" ? "Historical posted return — unchanged" : "Inspection required before approval"}</p>}
                {["card", "bank_transfer"].includes(record.resolution) && <label className="mt-2 block text-sm">Refund from company account
                  <select disabled={Boolean(record.bankAccountId)} value={record.bankAccountId || legacyRefundAccounts[record.id] || ""} onChange={(event) => setLegacyRefundAccounts((current) => ({ ...current, [record.id]: event.target.value }))} className="mt-1 w-full rounded-lg border p-3">
                    <option value="">Select funding account for this earlier return</option>
                    {bankAccounts.map((account) => <option key={account.id} value={account.id}>{account.bankName} · {account.accountName} · ••••{account.accountNumberLast4}</option>)}
                  </select>
                </label>}
              </div>
              {record.status === "submitted" && canApprove &&
              (record.createdBy !== user?.uid || canApproveOwnWork) ? (
                <Button disabled={busy || (record.kind !== "reservation_cancellation" && record.inspectionStatus !== "completed") || (record.kind === "reservation_cancellation" && (!profile || !hasPermission(profile, "sales.stock.release"))) || (["card", "bank_transfer"].includes(record.resolution) && !record.bankAccountId && !legacyRefundAccounts[record.id])} onClick={() => void approve(record)}>
                  <CheckCircle2 className="mr-2 size-4" /> Approve and post
                </Button>
              ) : (
                record.status === "submitted" && <span className="text-xs text-amber-800">
                  {record.createdBy === user?.uid
                    ? "This role requires another approver"
                    : "Approval permission required"}
                </span>
              )}
              {canApprove && <ReturnFollowUp record={record} accounts={bankAccounts} shifts={openShifts} onComplete={() => void refreshPending()} />}
            </article>
          ))}
          {pending.length === 0 && (
            <p className="rounded-lg bg-slate-50 p-6 text-center text-sm text-[var(--muted)]">
              No {status === "submitted" ? "pending" : "posted"} returns on this page.
            </p>
          )}
        </div>
        <CursorTablePagination page={scopedPages.length} pageSize={limit} rowCount={pending.length} hasNextPage={Boolean(nextCursor)} loading={busy} onPrevious={() => setPages(scopedPages.slice(0, -1))} onNext={() => { if (nextCursor) { setPageBranchId(branchId); setPages([...scopedPages, nextCursor]); } }} onPageSizeChange={size => { setLimit(size); setPages([null]); }} itemLabel="returns" />
      </section>
      <Button variant="secondary" onClick={() => setShowCorrections(value => !value)}>{showCorrections ? "Hide order corrections" : "Posted-order corrections"}</Button>
      {showCorrections && <SaleCorrections branchId={branchId} source={workspace?.sale.branchId === branchId ? workspace : null} canCreate={canCreate} canApprove={canApprove} />}
    </div>
  );
}

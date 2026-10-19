"use client";
import { FinancialMessage, FinancialText, FinancialValue } from "@/features/finance/financial-privacy";

import {
  ArrowRight,
  Boxes,
  Loader2,
  MapPin,
  Play,
  RefreshCw,
  Sparkles,
  Store,
  Warehouse as WarehouseIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { callAdministration } from "@/features/administration/api";
import { useOrganizationCollection } from "@/features/administration/use-organization-collection";
import { useAuth } from "@/features/auth/auth-context";
import {
  formatDateTime,
  formatNaira,
  formatQuantity,
} from "@/features/inventory/format";
import { canSelfAuthorize, hasPermission } from "@/lib/permissions/roles";
import { sensitiveActionDisabled, useConnectivity } from "@/lib/connectivity";
import {
  isTransferSelfApprovalBlocked,
  transferNextStepCopy,
} from "@/features/transfers/transfer-guidance";
import { TransferOperations } from "@/features/transfers/transfer-operations";
import type {
  Branch,
  BranchRequest,
  DateTimeValue,
  InventoryLocation,
  StockReservation,
  TransferCost,
  TransferItem,
  Warehouse,
  WarehouseTransfer,
} from "@/types/domain";

interface TransferDetailResult {
  transfer: WarehouseTransfer;
  items: TransferItem[];
  packages: Array<Record<string, unknown>>;
  dispatches: Array<Record<string, unknown>>;
  receipts: Array<Record<string, unknown>>;
  discrepancies: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
  costs: TransferCost[];
  reservations: StockReservation[];
  dispatchItems?: Array<Record<string, unknown>>;
  receiptBalances?: Array<Record<string, unknown>>;
}
const progressSteps = [
  "Draft",
  "Approval",
  "Prepare",
  "Dispatch",
  "Receive",
  "Complete",
] as const;
const statusProgress: Record<string, number> = {
  draft: 0,
  submitted: 1,
  under_review: 1,
  changes_requested: 1,
  approved: 2,
  partially_reserved: 2,
  reserved: 2,
  picking: 2,
  picked: 2,
  packing: 2,
  packed: 2,
  ready_for_dispatch: 3,
  partially_dispatched: 3,
  dispatched: 4,
  partially_received: 4,
  received: 5,
  cost_reconciliation: 5,
  closed: 5,
};

export function TransferDetail({ transferId }: { transferId: string }) {
  const { profile } = useAuth();
  const { online } = useConnectivity();
  const branches = useOrganizationCollection<Branch>("branches");
  const warehouses = useOrganizationCollection<Warehouse>("warehouses");
  const locations =
    useOrganizationCollection<InventoryLocation>("inventoryLocations");
  const requests = useOrganizationCollection<BranchRequest>("branchRequests");
  const [result, setResult] = useState<TransferDetailResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setResult(
        await callAdministration<object, TransferDetailResult>("getTransfer", {
          transferId,
          limit: 100,
        }),
      );
      setMessage(null);
    } catch {
      setMessage("This transfer could not be loaded for your assignment.");
    } finally {
      setLoading(false);
    }
  }, [transferId]);
  useEffect(() => {
    let active = true;
    void callAdministration<object, TransferDetailResult>("getTransfer", {
      transferId,
      limit: 100,
    })
      .then((value) => {
        if (active) {
          setResult(value);
          setMessage(null);
        }
      })
      .catch(() => {
        if (active)
          setMessage("This transfer could not be loaded for your assignment.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [transferId]);
  async function action(name: string, reason?: string) {
    if (!result) return;
    if (!online) {
      setMessage("Reconnect before confirming a transfer workflow action.");
      return;
    }
    setLoading(true);
    try {
      await callAdministration(name, {
        transferId,
        expectedVersion: result.transfer.version,
        reason,
        idempotencyKey: crypto.randomUUID(),
      });
      await load();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The transfer action could not be completed. Refresh and try again.",
      );
      setLoading(false);
    }
  }
  if (loading && !result)
    return (
      <div className="grid min-h-64 place-items-center">
        <Loader2 className="size-8 animate-spin text-[var(--brand)]" />
      </div>
    );
  if (!result || !profile)
    return (
      <p className="rounded-xl border bg-white p-8">
        <FinancialMessage>{message ?? "Transfer not found."}</FinancialMessage>
      </p>
    );
  const transfer = result.transfer;
  const originWarehouse = warehouses.data.find(
    (item) => item.id === transfer.originWarehouseId,
  );
  const destinationBranch = branches.data.find(
    (item) => item.id === transfer.destinationBranchId,
  );
  const originLocation = locations.data.find(
    (item) => item.id === transfer.originLocationId,
  );
  const destinationLocation = locations.data.find(
    (item) => item.id === transfer.destinationLocationId,
  );
  const sourceRequest = requests.data.find(
    (item) => item.id === transfer.sourceRequestId,
  );
  const selfApprovalBlocked = isTransferSelfApprovalBlocked(
    transfer.status,
    transfer.createdBy,
    profile.uid,
    canSelfAuthorize(profile),
  );
  const currentProgress = statusProgress[transfer.status] ?? 0;
  const keyQuantities = [
    ["Planned", transfer.totalPlannedQuantity],
    ["Approved", transfer.totalApprovedQuantity],
    ["Dispatched", transfer.totalDispatchedQuantity],
    ["Received", transfer.totalReceivedQuantity],
    ["Remaining", transfer.totalOutstandingQuantity],
  ] as const;
  return (
    <div className="min-w-0 space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/transfers"
            className="inline-flex min-h-11 items-center text-sm text-[var(--brand)] underline"
          >
            Transfers
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold">
              <FinancialText>{transfer.transferNumber}</FinancialText>
            </h1>
            <StatusBadge
              tone={
                transfer.status === "closed" || transfer.status === "received"
                  ? "success"
                  : transfer.status === "disputed"
                    ? "warning"
                    : "neutral"
              }
            >
              <FinancialText>{transfer.status.replaceAll("_", " ")}</FinancialText>
            </StatusBadge>
          </div>
          <p className="mt-1 text-sm text-[var(--muted)]">
            <FinancialText>{transfer.sourceType === "admin_allocation"
              ? "Direct allocation"
              : "From an approved branch request"}</FinancialText>
          </p>
        </div>
        <Button variant="secondary" onClick={() => void load()}>
          <RefreshCw className="mr-2 size-4" />
          Refresh
        </Button>
      </header>
      {message && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm"><FinancialMessage>{message}</FinancialMessage></p>
      )}
      <section className="brand-hero rounded-2xl p-5 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-100">
          Transfer route
        </p>
        <div className="mt-3 grid items-center gap-3 sm:grid-cols-[1fr_auto_1fr]">
          <div className="rounded-xl border border-white/15 bg-white/10 p-4 backdrop-blur-sm">
            <div className="flex items-start gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-white/15">
                <WarehouseIcon className="size-5" />
              </span>
              <div>
                <span className="block text-xs text-emerald-100">
                  From warehouse
                </span>
                <strong className="mt-1 block text-lg">
                  <FinancialText>{originWarehouse?.name ??
                    originLocation?.name ??
                    "Loading warehouse…"}</FinancialText>
                </strong>
                {originLocation &&
                  originLocation.name !== originWarehouse?.name && (
                    <span className="mt-1 flex items-center gap-1 text-xs text-emerald-100">
                      <MapPin className="size-3" />
                      <FinancialText>{originLocation.name}</FinancialText>
                    </span>
                  )}
              </div>
            </div>
          </div>
          <span
            className="mx-auto grid size-9 place-items-center rounded-full bg-amber-300 text-emerald-950"
            aria-hidden
          >
            <ArrowRight className="size-4" />
          </span>
          <div className="rounded-xl border border-white/20 bg-white p-4 text-[var(--foreground)] shadow-lg">
            <div className="flex items-start gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-800">
                <Store className="size-5" />
              </span>
              <div>
                <span className="block text-xs text-[var(--muted)]">
                  To store / branch
                </span>
                <strong className="mt-1 block text-lg">
                  <FinancialText>{destinationBranch?.name ??
                    destinationLocation?.name ??
                    "Loading destination…"}</FinancialText>
                </strong>
                {destinationLocation &&
                  destinationLocation.name !== destinationBranch?.name && (
                    <span className="mt-1 flex items-center gap-1 text-xs text-[var(--muted)]">
                      <MapPin className="size-3" />
                      <FinancialText>{destinationLocation.name}</FinancialText>
                    </span>
                  )}
              </div>
            </div>
          </div>
        </div>
        {transfer.purpose && (
          <p className="mt-4 text-sm text-emerald-50">
            <span className="text-emerald-200">Purpose:</span>{" "}
            <FinancialText>{transfer.purpose}</FinancialText>
          </p>
        )}
      </section>
      <section className="soft-grid rounded-2xl border border-emerald-200 bg-emerald-50 p-5 shadow-[var(--shadow-sm)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-emerald-800">
              <Sparkles className="size-4" />
              Next step
            </p>
            <p className="mt-1 max-w-2xl font-medium text-emerald-950">
              <FinancialText>{transferNextStepCopy(transfer.status, selfApprovalBlocked)}</FinancialText>
            </p>
            {selfApprovalBlocked && (
              <p className="mt-2 max-w-2xl text-sm text-emerald-900">
                Ask another assigned manager to open this transfer and approve
                it. The decision will be recorded in the audit trail.
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {transfer.status === "draft" &&
              hasPermission(profile, "transfers.submit") && (
                <Button
                  aria-busy={loading}
                  disabledReason={!online ? "Reconnect before changing a transfer stage. The assigned source/receiving manager must review current evidence; do not assume an interrupted action failed." : undefined}
                  disabled={sensitiveActionDisabled(online, loading)}
                  onClick={() => void action("submitTransfer")}
                >
                  Submit transfer
                </Button>
              )}
            {transfer.status === "submitted" &&
              hasPermission(profile, "transfers.review") && (
                <Button
                  aria-busy={loading}
                  disabledReason={!online ? "Reconnect before changing a transfer stage. The assigned source/receiving manager must review current evidence; do not assume an interrupted action failed." : undefined}
                  disabled={sensitiveActionDisabled(online, loading)}
                  variant="secondary"
                  onClick={() => void action("startTransferReview")}
                >
                  Start review
                </Button>
              )}
            {["submitted", "under_review"].includes(transfer.status) &&
              !selfApprovalBlocked &&
              hasPermission(profile, "transfers.approve") && (
                <Button
                  aria-busy={loading}
                  disabledReason={!online ? "Reconnect before changing a transfer stage. The assigned source/receiving manager must review current evidence; do not assume an interrupted action failed." : undefined}
                  disabled={sensitiveActionDisabled(online, loading)}
                  onClick={() => void action("approveTransfer")}
                >
                  Approve transfer
                </Button>
              )}
            {["approved", "partially_reserved"].includes(transfer.status) &&
              hasPermission(profile, "transfers.reserve") &&
              result.items.every(
                (item) => item.trackingType === "quantity",
              ) && (
                <Button
                  aria-busy={loading}
                  disabledReason={!online ? "Reconnect before changing a transfer stage. The assigned source/receiving manager must review current evidence; do not assume an interrupted action failed." : undefined}
                  disabled={sensitiveActionDisabled(online, loading)}
                  onClick={() => void action("reserveTransferStock")}
                >
                  Reserve stock
                </Button>
              )}
            {["reserved", "partially_reserved"].includes(transfer.status) &&
              hasPermission(profile, "transfers.pick") && (
                <Button
                  aria-busy={loading}
                  disabledReason={!online ? "Reconnect before changing a transfer stage. The assigned source/receiving manager must review current evidence; do not assume an interrupted action failed." : undefined}
                  disabled={sensitiveActionDisabled(online, loading)}
                  onClick={() => void action("startTransferPicking")}
                >
                  <Play className="mr-2 size-4" />
                  Start picking
                </Button>
              )}
            {["received", "cost_reconciliation"].includes(transfer.status) &&
              hasPermission(profile, "transfers.close") && (
                <Button
                  aria-busy={loading}
                  disabledReason={!online ? "Reconnect before changing a transfer stage. The assigned source/receiving manager must review current evidence; do not assume an interrupted action failed." : undefined}
                  disabled={sensitiveActionDisabled(online, loading)}
                  onClick={() => void action("closeTransfer")}
                >
                  Validate and close
                </Button>
              )}
          </div>
        </div>
      </section>
      <TransferOperations
        transfer={transfer}
        items={result.items}
        reservations={result.reservations ?? []}
        packages={
          result.packages as Array<
            Record<string, unknown> & { id: string; status?: string }
          >
        }
        dispatches={
          result.dispatches as Array<
            Record<string, unknown> & { id: string; status?: string }
          >
        }
        dispatchItems={result.dispatchItems ?? []}
        receiptBalances={result.receiptBalances ?? []}
        online={online}
        onComplete={load}
      />
      <section className="surface p-5">
        <h2 className="text-lg font-semibold">Progress</h2>
        <ol className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {progressSteps.map((step, index) => (
            <li key={step} className="text-center">
              <span
                className={`mx-auto grid size-8 place-items-center rounded-full text-sm font-semibold ${index <= currentProgress ? "bg-[var(--brand)] text-white" : "bg-slate-100 text-slate-500"}`}
              >
                <FinancialText>{index < currentProgress ? "✓" : index + 1}</FinancialText>
              </span>
              <span className="mt-1 block text-xs text-[var(--muted)]">
                <FinancialText>{step}</FinancialText>
              </span>
            </li>
          ))}
        </ol>
      </section>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {keyQuantities.map(([label, value], index) => (
          <div
            key={label}
            className="interactive-card rounded-2xl border bg-white p-4 shadow-[var(--shadow-sm)]"
          >
            <span
              className={`mb-3 grid size-9 place-items-center rounded-xl ${index === 4 ? "bg-amber-100 text-amber-800" : "bg-emerald-50 text-emerald-700"}`}
            >
              <Boxes className="size-4" />
            </span>
            <p className="text-2xl font-semibold"><FinancialText>{formatQuantity(value)}</FinancialText></p>
            <p className="text-xs text-[var(--muted)]"><FinancialText>{label}</FinancialText></p>
          </div>
        ))}
      </section>
      <section className="rounded-xl border bg-white p-5">
        <h2 className="text-lg font-semibold">Products in this transfer</h2>
        <div className="mt-4 grid gap-3">
          {result.items.map((item) => (
            <article key={item.id} className="rounded-xl border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold"><FinancialText>{item.productName}</FinancialText></h3>
                  <p className="text-xs text-[var(--muted)]">
                    <FinancialText>{item.sku}</FinancialText> · <FinancialText>{item.unitOfMeasure}</FinancialText> · <FinancialText>{item.trackingType}</FinancialText>{" "}
                    tracking
                  </p>
                </div>
                <StatusBadge status={item.itemStatus} />
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
                {[
                  ["Planned", item.plannedQuantity],
                  ["Approved", item.approvedQuantity],
                  ["Reserved", item.reservedQuantity],
                  ["Dispatched", item.dispatchedQuantity],
                  ["Received", item.receivedQuantity],
                ].map(([label, value]) => (
                  <div
                    key={String(label)}
                    className="rounded-lg bg-slate-50 p-3"
                  >
                    <dt className="text-xs text-[var(--muted)]"><FinancialText>{label}</FinancialText></dt>
                    <dd className="mt-1 text-lg font-semibold">
                      <FinancialText>{formatQuantity(Number(value))}</FinancialText>
                    </dd>
                  </div>
                ))}
              </dl>
            </article>
          ))}
        </div>
      </section>
      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border bg-white p-5">
          <h2 className="text-lg font-semibold">Operational timeline</h2>
          {result.events.length ? (
            <ol className="mt-4 space-y-3">
              {result.events.map((event, index) => (
                <li
                  key={String(event.id ?? index)}
                  className="border-l-2 border-emerald-200 pl-4"
                >
                  <p className="font-medium">
                    <FinancialText>{String(event.eventType ?? "event").replaceAll("_", " ")}</FinancialText>
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    <FinancialText>{formatDateTime(
                      event.createdAt as DateTimeValue | undefined,
                    )}</FinancialText>
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-3 text-sm text-[var(--muted)]">
              No activity has been recorded yet.
            </p>
          )}
        </div>
        <div className="space-y-4">
          <div className="rounded-xl border bg-white p-5">
            <h2 className="text-lg font-semibold">Movement records</h2>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              {[
                ["Packages", result.packages.length],
                ["Dispatches", result.dispatches.length],
                ["Receipts", result.receipts.length],
                ["Issues", result.discrepancies.length],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-lg bg-slate-50 p-3">
                  <dt className="text-xs text-[var(--muted)]"><FinancialText>{label}</FinancialText></dt>
                  <dd className="mt-1 text-lg font-semibold"><FinancialText>{value}</FinancialText></dd>
                </div>
              ))}
            </dl>
          </div>
          {hasPermission(profile, "transfers.cost.read") && (
            <div className="rounded-xl border bg-white p-5">
              <h2 className="text-lg font-semibold">Transfer costs</h2>
              <p className="mt-2 text-sm">
                Estimated <FinancialValue>{formatNaira(transfer.estimatedCostMinor)}</FinancialValue> · Approved{" "}
                <FinancialValue>{formatNaira(transfer.approvedCostMinor)}</FinancialValue> · Actual{" "}
                <FinancialValue>{formatNaira(transfer.actualCostMinor)}</FinancialValue>
              </p>
              <p className="text-xs text-[var(--muted)]">
                <FinancialText>{result.costs.length}</FinancialText> auditable cost records
              </p>
            </div>
          )}
        </div>
      </section>
      <details className="rounded-xl border bg-white p-5">
        <summary className="cursor-pointer font-semibold">
          Record details
        </summary>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-[var(--muted)]">Source</dt>
            <dd>
              <FinancialText>{sourceRequest
                ? sourceRequest.requestNumber
                : transfer.sourceRequestId
                  ? "Approved branch request"
                  : "Direct allocation"}</FinancialText>
            </dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Priority</dt>
            <dd className="capitalize"><FinancialText>{transfer.priority}</FinancialText></dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Created</dt>
            <dd><FinancialText>{formatDateTime(transfer.createdAt)}</FinancialText></dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Last updated</dt>
            <dd><FinancialText>{formatDateTime(transfer.updatedAt)}</FinancialText></dd>
          </div>
        </dl>
        <details className="mt-4 border-t pt-4 text-xs text-[var(--muted)]">
          <summary className="cursor-pointer">Technical references</summary>
          <dl className="mt-3 grid gap-2 break-all sm:grid-cols-2">
            <div>
              <dt>Transfer ID</dt>
              <dd><FinancialText>{transfer.id}</FinancialText></dd>
            </div>
            <div>
              <dt>Origin location ID</dt>
              <dd><FinancialText>{transfer.originLocationId}</FinancialText></dd>
            </div>
            <div>
              <dt>Destination location ID</dt>
              <dd><FinancialText>{transfer.destinationLocationId}</FinancialText></dd>
            </div>
            <div>
              <dt>Transit location ID</dt>
              <dd><FinancialText>{transfer.transitLocationId}</FinancialText></dd>
            </div>
          </dl>
        </details>
      </details>
    </div>
  );
}

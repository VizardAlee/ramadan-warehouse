"use client";

import { Loader2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { callAdministration } from "@/features/administration/api";
import { useAuth } from "@/features/auth/auth-context";
import { hasPermission } from "@/lib/permissions/roles";
import { sensitiveActionDisabled, useConnectivity } from "@/lib/connectivity";
import type {
  TransferCost,
  TransferItem,
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
}
const quantityFields = [
  "Planned",
  "Approved",
  "Reserved",
  "Picked",
  "Packed",
  "Dispatched",
  "Received",
  "Damaged",
  "Missing",
  "Outstanding",
] as const;
export function TransferDetail({ transferId }: { transferId: string }) {
  const { profile } = useAuth();
  const { online } = useConnectivity();
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
    } catch {
      setMessage(
        "The operation was rejected because a workflow, permission, quantity, or maker-checker control was not satisfied.",
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
        {message ?? "Transfer not found."}
      </p>
    );
  const transfer = result.transfer;
  const totalKey = (label: (typeof quantityFields)[number]) =>
    `total${label}Quantity` as keyof WarehouseTransfer;
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/transfers"
            className="text-sm text-[var(--brand)] underline"
          >
            Transfers
          </Link>
          <div className="mt-2 flex items-center gap-3">
            <h1 className="text-3xl font-semibold">
              {transfer.transferNumber}
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
              {transfer.status.replaceAll("_", " ")}
            </StatusBadge>
          </div>
          <p className="mt-1 text-[var(--muted)]">
            {transfer.sourceType.replaceAll("_", " ")} ·{" "}
            {transfer.originWarehouseId} → {transfer.destinationBranchId}
          </p>
        </div>
        <Button variant="secondary" onClick={() => void load()}>
          <RefreshCw className="mr-2 size-4" />
          Refresh
        </Button>
      </header>
      {message && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm">{message}</p>
      )}
      <section className="flex flex-wrap gap-2 rounded-xl border bg-white p-4">
        {transfer.status === "draft" &&
          hasPermission(profile, "transfers.submit") && (
            <Button disabled={sensitiveActionDisabled(online, loading)} onClick={() => void action("submitTransfer")}>
              Submit transfer
            </Button>
          )}
        {transfer.status === "submitted" &&
          hasPermission(profile, "transfers.review") && (
            <Button
              disabled={sensitiveActionDisabled(online, loading)}
              variant="secondary"
              onClick={() => void action("startTransferReview")}
            >
              Start review
            </Button>
          )}
        {["submitted", "under_review"].includes(transfer.status) &&
          hasPermission(profile, "transfers.approve") && (
            <Button disabled={sensitiveActionDisabled(online, loading)} onClick={() => void action("approveTransfer")}>
              Approve version {transfer.version}
            </Button>
          )}
        {["approved", "partially_reserved"].includes(transfer.status) &&
          hasPermission(profile, "transfers.reserve") &&
          result.items.every((item) => item.trackingType === "quantity") && (
            <Button disabled={sensitiveActionDisabled(online, loading)} onClick={() => void action("reserveTransferStock")}>
              Reserve quantity stock
            </Button>
          )}
        {["received", "cost_reconciliation"].includes(transfer.status) &&
          hasPermission(profile, "transfers.close") && (
            <Button disabled={sensitiveActionDisabled(online, loading)} onClick={() => void action("closeTransfer")}>
              Validate and close
            </Button>
          )}
      </section>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {quantityFields.map((label) => (
          <div key={label} className="rounded-xl border bg-white p-4">
            <p className="text-2xl font-semibold">
              {String(transfer[totalKey(label)] ?? 0)}
            </p>
            <p className="text-xs text-[var(--muted)]">{label}</p>
          </div>
        ))}
      </section>
      <section className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border bg-white p-5 lg:col-span-2">
          <h2 className="text-lg font-semibold">Transfer items</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full whitespace-nowrap text-left text-sm">
              <thead>
                <tr>
                  {[
                    "Product",
                    "Approved",
                    "Reserved",
                    "Picked",
                    "Packed",
                    "Dispatched",
                    "Received",
                    "Status",
                  ].map((label) => (
                    <th key={label} className="border-b px-3 py-2">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.items.map((item) => (
                  <tr key={item.id}>
                    <td className="border-b px-3 py-3">
                      <span className="font-medium">{item.sku}</span>
                      <span className="block text-xs text-[var(--muted)]">
                        {item.productName} · {item.trackingType}
                      </span>
                    </td>
                    <td className="border-b px-3">{item.approvedQuantity}</td>
                    <td className="border-b px-3">{item.reservedQuantity}</td>
                    <td className="border-b px-3">{item.pickedQuantity}</td>
                    <td className="border-b px-3">{item.packedQuantity}</td>
                    <td className="border-b px-3">{item.dispatchedQuantity}</td>
                    <td className="border-b px-3">{item.receivedQuantity}</td>
                    <td className="border-b px-3">
                      {item.itemStatus.replaceAll("_", " ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <aside className="space-y-3 rounded-xl border bg-white p-5">
          <h2 className="text-lg font-semibold">Control references</h2>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-[var(--muted)]">Source request</dt>
              <dd>{transfer.sourceRequestId ?? "Direct allocation"}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Origin location</dt>
              <dd>{transfer.originLocationId}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Transit location</dt>
              <dd>{transfer.transitLocationId}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Destination location</dt>
              <dd>{transfer.destinationLocationId}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Priority</dt>
              <dd>{transfer.priority}</dd>
            </div>
          </dl>
        </aside>
      </section>
      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border bg-white p-5">
          <h2 className="text-lg font-semibold">Operational timeline</h2>
          <ol className="mt-4 space-y-3">
            {result.events.map((event, index) => (
              <li
                key={String(event.id ?? index)}
                className="border-l-2 border-emerald-200 pl-4"
              >
                <p className="font-medium">
                  {String(event.eventType ?? "event").replaceAll("_", " ")}
                </p>
                <p className="text-xs text-[var(--muted)]">
                  {String(event.createdAt ?? "Pending timestamp")}
                </p>
              </li>
            ))}
          </ol>
        </div>
        <div className="space-y-4">
          <div className="rounded-xl border bg-white p-5">
            <h2 className="text-lg font-semibold">Execution records</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              {result.packages.length} packages · {result.dispatches.length}{" "}
              dispatches · {result.receipts.length} receipts ·{" "}
              {result.discrepancies.length} discrepancies
            </p>
          </div>
          {hasPermission(profile, "transfers.cost.read") && (
            <div className="rounded-xl border bg-white p-5">
              <h2 className="text-lg font-semibold">Transfer costs</h2>
              <p className="mt-2 text-sm">
                Estimated ₦
                {(transfer.estimatedCostMinor / 100).toLocaleString()} ·
                Approved ₦{(transfer.approvedCostMinor / 100).toLocaleString()}{" "}
                · Actual ₦{(transfer.actualCostMinor / 100).toLocaleString()}
              </p>
              <p className="text-xs text-[var(--muted)]">
                {result.costs.length} auditable cost records
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

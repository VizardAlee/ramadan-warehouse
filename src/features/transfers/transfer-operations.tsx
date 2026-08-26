"use client";

import {
  Boxes,
  CheckCircle2,
  Loader2,
  MapPin,
  PackageCheck,
  Route,
  Truck,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import { useAuth } from "@/features/auth/auth-context";
import { hasOrganizationWideOperatingAccess } from "@/features/auth/operating-context";
import { hasPermission } from "@/lib/permissions/roles";
import type {
  StockReservation,
  TransferItem,
  WarehouseTransfer,
} from "@/types/domain";

type RelatedRecord = Record<string, unknown> & { id: string; status?: string };

interface TransferOperationsProps {
  transfer: WarehouseTransfer;
  items: TransferItem[];
  reservations: StockReservation[];
  packages: RelatedRecord[];
  dispatches: RelatedRecord[];
  online: boolean;
  onComplete: () => Promise<void>;
}

function allocationSlice(
  allocations: Array<{ lotId: string; quantity: number }> = [],
  skip: number,
  quantity: number,
) {
  let remainingSkip = skip;
  let remaining = quantity;
  const selected: Array<{ lotId: string; quantity: number }> = [];
  for (const allocation of allocations) {
    if (remaining <= 0) break;
    const availableAfterSkip = Math.max(0, allocation.quantity - remainingSkip);
    if (remainingSkip >= allocation.quantity) {
      remainingSkip -= allocation.quantity;
      continue;
    }
    remainingSkip = 0;
    const used = Math.min(availableAfterSkip, remaining);
    if (used > 0) selected.push({ lotId: allocation.lotId, quantity: used });
    remaining -= used;
  }
  return selected;
}

export function buildPreparationLines(
  items: TransferItem[],
  reservations: StockReservation[],
  stage: "pick" | "pack",
) {
  return items.flatMap((item) => {
    const completed = stage === "pick" ? item.pickedQuantity : item.packedQuantity;
    const available = stage === "pick" ? item.reservedQuantity : item.pickedQuantity;
    const quantity = Math.max(0, available - completed);
    if (quantity <= 0) return [];
    const reservation = reservations.find(
      (candidate) => candidate.transferItemId === item.id,
    );
    return [{
      transferItemId: item.id,
      quantity,
      serialItemIds:
        item.trackingType === "serial"
          ? (reservation?.serialItemIds ?? []).slice(completed, completed + quantity)
          : [],
      lotAllocations:
        item.trackingType === "batch"
          ? allocationSlice(reservation?.lotAllocations, completed, quantity)
          : [],
    }];
  });
}

export function TransferOperations({
  transfer,
  items,
  reservations,
  packages,
  dispatches,
  online,
  onComplete,
}: TransferOperationsProps) {
  const { profile, accessProfile, operatingContext } = useAuth();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [driverName, setDriverName] = useState("");
  const [driverPhoneNumber, setDriverPhoneNumber] = useState("");
  const [vehicleRegistration, setVehicleRegistration] = useState("");
  const [transportCompany, setTransportCompany] = useState("");
  const [waybillNumber, setWaybillNumber] = useState("");
  const pickLines = useMemo(
    () => buildPreparationLines(items, reservations, "pick"),
    [items, reservations],
  );
  const packLines = useMemo(
    () => buildPreparationLines(items, reservations, "pack"),
    [items, reservations],
  );
  const sealedPackages = packages.filter((item) => item.status === "sealed");
  const activeDispatch = dispatches.find((item) =>
    ["in_transit", "partially_received"].includes(String(item.status)),
  );
  if (!profile) return null;

  async function run(task: () => Promise<void>, success: string) {
    if (!online) {
      setMessage("Reconnect before completing this transfer step.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await task();
      setMessage(success);
      await onComplete();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "This transfer step could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  async function recordPick() {
    await run(async () => {
      await callAdministration("recordPickedItems", {
        transferId: transfer.id,
        expectedVersion: transfer.version,
        lines: pickLines,
        pickerNote: "Picked through the guided transfer workspace",
        idempotencyKey: crypto.randomUUID(),
      });
    }, "Picked quantities recorded. The transfer is ready to pack.");
  }

  async function packAndSeal() {
    await run(async () => {
      const created = await callAdministration<object, { packageId: string }>(
        "createTransferPackage",
        {
          transferId: transfer.id,
          expectedVersion: transfer.version,
          packageType: "standard",
          notes: "Packed through the guided transfer workspace",
          lines: packLines,
          idempotencyKey: crypto.randomUUID(),
        },
      );
      await callAdministration("sealTransferPackage", {
        transferId: transfer.id,
        expectedVersion: transfer.version,
        packageId: created.packageId,
        idempotencyKey: crypto.randomUUID(),
      });
    }, "Goods packed and sealed. Dispatch details can now be recorded.");
  }

  async function dispatchNow() {
    const payload = {
      transferId: transfer.id,
      expectedVersion: transfer.version,
      packageIds: sealedPackages.map((item) => item.id),
      driverName: driverName.trim(),
      driverPhoneNumber: driverPhoneNumber.trim() || undefined,
      vehicleRegistration: vehicleRegistration.trim() || undefined,
      transportCompany: transportCompany.trim() || undefined,
      waybillNumber: waybillNumber.trim() || undefined,
    };
    await run(async () => {
      const created = await callAdministration<object, { dispatchId: string }>(
        "createTransferDispatch",
        { ...payload, idempotencyKey: crypto.randomUUID() },
      );
      await callAdministration("confirmTransferDispatch", {
        ...payload,
        dispatchId: created.dispatchId,
        idempotencyKey: crypto.randomUUID(),
      });
    }, "Dispatch confirmed. Inventory is now in transit to the destination branch.");
  }

  async function receiveAll() {
    if (!activeDispatch) return;
    const lines = items.flatMap((item) => {
      const quantity = Math.max(0, item.dispatchedQuantity - item.receivedQuantity - item.damagedQuantity);
      if (quantity <= 0) return [];
      const reservation = reservations.find((candidate) => candidate.transferItemId === item.id);
      return [{
        transferItemId: item.id,
        receivedQuantity: quantity,
        damagedQuantity: 0,
        missingQuantity: 0,
        rejectedQuantity: 0,
        serialItemIds: item.trackingType === "serial"
          ? (reservation?.serialItemIds ?? []).slice(item.receivedQuantity, item.receivedQuantity + quantity)
          : [],
        damagedSerialItemIds: [],
        lotAllocations: item.trackingType === "batch"
          ? allocationSlice(reservation?.lotAllocations, item.receivedQuantity, quantity)
              .map((allocation) => ({ ...allocation, disposition: "received" as const }))
          : [],
      }];
    });
    const payload = {
      transferId: transfer.id,
      expectedVersion: transfer.version,
      dispatchId: activeDispatch.id,
      deliveryCondition: "good" as const,
      receiverNote: "Received in full through the guided transfer workspace",
      photoReferences: [],
      lines,
    };
    await run(async () => {
      const created = await callAdministration<object, { receiptId: string }>(
        "createTransferReceipt",
        { ...payload, idempotencyKey: crypto.randomUUID() },
      );
      await callAdministration("confirmTransferReceipt", {
        ...payload,
        receiptId: created.receiptId,
        idempotencyKey: crypto.randomUUID(),
      });
    }, "Receipt confirmed. Inventory is now available at the destination branch.");
  }

  const warehouseContextRequired =
    ["picking", "picked", "partially_picked", "packing", "ready_for_dispatch"].includes(transfer.status) &&
    operatingContext?.type === "branch" &&
    Boolean(accessProfile && !hasOrganizationWideOperatingAccess(accessProfile));

  return (
    <section className="surface overflow-hidden">
      <div className="brand-hero flex flex-wrap items-center justify-between gap-4 rounded-none px-5 py-5 sm:px-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-emerald-100">Guided transfer workspace</p>
          <h2 className="mt-1 text-xl font-semibold">Complete one clear step at a time</h2>
        </div>
        <Route className="size-8 text-amber-300" />
      </div>
      <div className="p-5 sm:p-6">
        {message && <p role="status" className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-950">{message}</p>}
        {warehouseContextRequired && (
          <div className="mb-4 flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
            <MapPin className="mt-0.5 size-5 shrink-0" />
            <div><strong>Switch to the origin warehouse.</strong><p className="mt-1">Choose the warehouse option from Working location above before preparing or dispatching stock.</p></div>
          </div>
        )}

        {transfer.status === "picking" && hasPermission(profile, "transfers.pick") && (
          <div className="grid items-center gap-4 md:grid-cols-[auto_1fr_auto]">
            <span className="grid size-12 place-items-center rounded-2xl bg-emerald-100 text-emerald-800"><CheckCircle2 /></span>
            <div><h3 className="font-semibold">Record picked goods</h3><p className="text-sm text-[var(--muted)]">Record all {pickLines.reduce((sum, line) => sum + line.quantity, 0)} reserved units physically collected.</p></div>
            <Button disabled={busy || pickLines.length === 0 || warehouseContextRequired} onClick={() => void recordPick()}>{busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}Confirm picked</Button>
          </div>
        )}

        {["picked", "partially_picked", "packing"].includes(transfer.status) && hasPermission(profile, "transfers.pack") && (
          <div className="grid items-center gap-4 md:grid-cols-[auto_1fr_auto]">
            <span className="grid size-12 place-items-center rounded-2xl bg-blue-100 text-blue-800"><Boxes /></span>
            <div><h3 className="font-semibold">Pack and seal</h3><p className="text-sm text-[var(--muted)]">Create one auditable package for the {packLines.reduce((sum, line) => sum + line.quantity, 0)} picked units.</p></div>
            <Button disabled={busy || packLines.length === 0 || warehouseContextRequired} onClick={() => void packAndSeal()}>{busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}Pack and seal</Button>
          </div>
        )}

        {transfer.status === "ready_for_dispatch" && hasPermission(profile, "transfers.dispatch") && (
          <div className="space-y-5">
            <div className="flex items-start gap-3"><span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-amber-100 text-amber-800"><Truck /></span><div><h3 className="font-semibold">Dispatch sealed goods</h3><p className="text-sm text-[var(--muted)]">Add the essential delivery details. Confirmation moves inventory into transit immediately.</p></div></div>
            <div className="form-grid">
              <label className="text-sm font-medium">Driver name<input value={driverName} onChange={(event) => setDriverName(event.target.value)} className="mt-1 w-full rounded-lg border p-3" placeholder="Full name" /></label>
              <label className="text-sm font-medium">Driver phone (optional)<input value={driverPhoneNumber} onChange={(event) => setDriverPhoneNumber(event.target.value)} className="mt-1 w-full rounded-lg border p-3" placeholder="070…" /></label>
              <label className="text-sm font-medium">Vehicle registration (optional)<input value={vehicleRegistration} onChange={(event) => setVehicleRegistration(event.target.value)} className="mt-1 w-full rounded-lg border p-3" placeholder="ABC-123XY" /></label>
              <label className="text-sm font-medium">Transport company (optional)<input value={transportCompany} onChange={(event) => setTransportCompany(event.target.value)} className="mt-1 w-full rounded-lg border p-3" /></label>
              <label className="text-sm font-medium">Waybill number (optional)<input value={waybillNumber} onChange={(event) => setWaybillNumber(event.target.value)} className="mt-1 w-full rounded-lg border p-3" /></label>
            </div>
            <Button disabled={busy || !driverName.trim() || sealedPackages.length === 0 || warehouseContextRequired} onClick={() => void dispatchNow()}>{busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Truck className="mr-2 size-4" />}Confirm dispatch</Button>
          </div>
        )}

        {["dispatched", "partially_received"].includes(transfer.status) && hasPermission(profile, "transfers.receive") && activeDispatch && (
          <div className="grid items-center gap-4 md:grid-cols-[auto_1fr_auto]">
            <span className="grid size-12 place-items-center rounded-2xl bg-emerald-100 text-emerald-800"><PackageCheck /></span>
            <div><h3 className="font-semibold">Confirm destination receipt</h3><p className="text-sm text-[var(--muted)]">Use this only when every dispatched item arrived in good condition. Damage or shortages must use discrepancy receiving.</p></div>
            <Button disabled={busy} onClick={() => void receiveAll()}>{busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}Receive all in good condition</Button>
          </div>
        )}
      </div>
    </section>
  );
}

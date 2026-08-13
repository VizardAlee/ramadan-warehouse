"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import { useOrganizationCollection } from "@/features/administration/use-organization-collection";
import type {
  Branch,
  BranchRequest,
  BranchRequestItem,
  InventoryLocation,
  Product,
  Warehouse,
} from "@/types/domain";

interface Line {
  productId: string;
  quantity: number;
  sourceRequestItemId?: string;
}
export function TransferForm({ source }: { source: "request" | "direct" }) {
  const router = useRouter();
  const branches = useOrganizationCollection<Branch>("branches");
  const warehouses = useOrganizationCollection<Warehouse>("warehouses");
  const locations =
    useOrganizationCollection<InventoryLocation>("inventoryLocations");
  const products = useOrganizationCollection<Product>("products");
  const [requests, setRequests] = useState<BranchRequest[]>([]);
  const [requestId, setRequestId] = useState("");
  const [requestVersion, setRequestVersion] = useState(0);
  const [approvalId, setApprovalId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [originLocationId, setOriginLocationId] = useState("");
  const [destinationLocationId, setDestinationLocationId] = useState("");
  const [purpose, setPurpose] = useState("");
  const [priority, setPriority] = useState("normal");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<Line[]>([{ productId: "", quantity: 1 }]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (source === "request")
      void callAdministration<object, { rows: BranchRequest[] }>(
        "listBranchRequests",
        { limit: 100 },
      ).then((result) =>
        setRequests(
          result.rows.filter((row) =>
            ["approved", "partially_approved", "partially_fulfilled"].includes(
              row.status,
            ),
          ),
        ),
      );
  }, [source]);
  async function selectRequest(id: string) {
    setRequestId(id);
    if (!id) return;
    try {
      const result = await callAdministration<
        object,
        {
          request: BranchRequest;
          items: BranchRequestItem[];
          versions: Array<{ version: number }>;
        }
      >("getBranchRequest", { requestId: id, limit: 100 });
      const timeline = await callAdministration<
        object,
        {
          approvals: Array<{
            id: string;
            requestVersion: number;
            decision: string;
          }>;
        }
      >("getBranchRequestTimeline", { requestId: id, limit: 100 });
      setBranchId(result.request.branchId);
      setRequestVersion(result.request.version);
      setApprovalId(
        timeline.approvals.find(
          (item) =>
            item.requestVersion === result.request.version &&
            ["approved", "partially_approved"].includes(item.decision),
        )?.id ?? "",
      );
      setPurpose(result.request.purpose);
      setPriority(result.request.priority);
      setLines(
        result.items
          .filter((item) => item.outstandingQuantity > 0)
          .map((item) => ({
            productId: item.productId,
            quantity: Math.max(
              1,
              item.outstandingQuantity -
                Number(
                  (
                    item as BranchRequestItem & {
                      transferAllocatedQuantity?: number;
                    }
                  ).transferAllocatedQuantity ?? 0,
                ),
            ),
            sourceRequestItemId: item.id,
          })),
      );
    } catch {
      setMessage("The approved request could not be loaded.");
    }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const result = await callAdministration<object, { transferId: string }>(
        source === "request"
          ? "createTransferFromRequest"
          : "createAdminTransfer",
        {
          ...(source === "request"
            ? {
                sourceRequestId: requestId,
                sourceRequestVersion: requestVersion,
                sourceApprovalId: approvalId,
              }
            : { directTransferReason: reason }),
          originWarehouseId: warehouseId,
          originLocationId,
          destinationBranchId: branchId,
          destinationLocationId,
          purpose,
          priority,
          items: lines,
          idempotencyKey: crypto.randomUUID(),
        },
      );
      router.push(`/transfers/${result.transferId}`);
    } catch {
      setMessage(
        "Transfer creation failed. Check assignments, approved quantities, and active locations.",
      );
    } finally {
      setSaving(false);
    }
  }
  const inputClass = "min-h-11 rounded-lg border bg-white px-3 py-2";
  return (
    <form onSubmit={submit} className="mx-auto max-w-5xl space-y-6">
      <header>
        <p className="text-sm font-semibold uppercase tracking-wide text-[var(--brand)]">
          Transfer initiation
        </p>
        <h1 className="text-3xl font-semibold">
          {source === "request"
            ? "Create from approved request"
            : "Create direct allocation"}
        </h1>
        <p className="text-[var(--muted)]">
          Draft quantities remain non-physical until approved, reserved, packed,
          and dispatched.
        </p>
      </header>
      {message && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm">{message}</p>
      )}
      <section className="form-grid rounded-xl border bg-white p-[clamp(1rem,3vw,1.5rem)]">
        {source === "request" && (
          <label className="md:col-span-2">
            Approved request
            <select
              required
              className={`${inputClass} mt-1 w-full`}
              value={requestId}
              onChange={(event) => void selectRequest(event.target.value)}
            >
              <option value="">Select request</option>
              {requests.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.requestNumber} · {item.branchId} ·{" "}
                  {item.totalOutstandingQuantity} outstanding
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Origin warehouse
          <select
            required
            className={`${inputClass} mt-1 w-full`}
            value={warehouseId}
            onChange={(event) => {
              setWarehouseId(event.target.value);
              setOriginLocationId("");
            }}
          >
            <option value="">Select warehouse</option>
            {warehouses.data
              .filter((item) => item.status === "active")
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Origin stock location
          <select
            required
            className={`${inputClass} mt-1 w-full`}
            value={originLocationId}
            onChange={(event) => setOriginLocationId(event.target.value)}
          >
            <option value="">Select location</option>
            {locations.data
              .filter(
                (item) =>
                  item.warehouseId === warehouseId &&
                  item.status === "active" &&
                  item.type === "warehouse",
              )
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Destination branch
          <select
            required
            disabled={source === "request"}
            className={`${inputClass} mt-1 w-full`}
            value={branchId}
            onChange={(event) => {
              setBranchId(event.target.value);
              setDestinationLocationId("");
            }}
          >
            <option value="">Select branch</option>
            {branches.data
              .filter((item) => item.status === "active")
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Destination available location
          <select
            required
            className={`${inputClass} mt-1 w-full`}
            value={destinationLocationId}
            onChange={(event) => setDestinationLocationId(event.target.value)}
          >
            <option value="">Select location</option>
            {locations.data
              .filter(
                (item) =>
                  item.branchId === branchId &&
                  item.status === "active" &&
                  item.type === "branch",
              )
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
        </label>
        <label className="md:col-span-2">
          Purpose
          <textarea
            required
            minLength={5}
            className={`${inputClass} mt-1 min-h-24 w-full`}
            value={purpose}
            onChange={(event) => setPurpose(event.target.value)}
          />
        </label>
        {source === "direct" && (
          <label className="md:col-span-2">
            Direct-transfer reason
            <textarea
              required
              minLength={5}
              className={`${inputClass} mt-1 min-h-20 w-full`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
        )}
        <label>
          Priority
          <select
            className={`${inputClass} mt-1 w-full`}
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
          >
            {["low", "normal", "high", "urgent", "critical"].map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
      </section>
      <section className="space-y-3 rounded-xl border bg-white p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Transfer items</h2>
            <p className="text-sm text-[var(--muted)]">
              Product identity and snapshots are resolved by the server.
            </p>
          </div>
          {source === "direct" && (
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                setLines((value) => [...value, { productId: "", quantity: 1 }])
              }
            >
              <Plus className="mr-2 size-4" />
              Add item
            </Button>
          )}
        </div>
        {lines.map((line, index) => (
          <div
            key={`${line.sourceRequestItemId ?? "direct"}-${index}`}
            className="grid items-end gap-3 rounded-lg border p-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,11rem),1fr))]"
          >
            <select
              required
              disabled={source === "request"}
              className={inputClass}
              value={line.productId}
              onChange={(event) =>
                setLines((value) =>
                  value.map((item, itemIndex) =>
                    itemIndex === index
                      ? { ...item, productId: event.target.value }
                      : item,
                  ),
                )
              }
            >
              <option value="">Select product</option>
              {products.data
                .filter((item) => item.active)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.sku} · {item.name}
                  </option>
                ))}
            </select>
            <input
              required
              type="number"
              min={1}
              step={1}
              className={inputClass}
              value={line.quantity}
              onChange={(event) =>
                setLines((value) =>
                  value.map((item, itemIndex) =>
                    itemIndex === index
                      ? { ...item, quantity: Number(event.target.value) }
                      : item,
                  ),
                )
              }
            />
            {source === "direct" && lines.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  setLines((value) =>
                    value.filter((_, itemIndex) => itemIndex !== index),
                  )
                }
              >
                <Trash2 className="size-4" />
                <span className="sr-only">Remove item</span>
              </Button>
            )}
          </div>
        ))}
      </section>
      <div className="flex justify-end">
        <Button type="submit" disabled={saving || !lines.length}>
          {saving && <Loader2 className="mr-2 size-4 animate-spin" />}Create
          draft transfer
        </Button>
      </div>
    </form>
  );
}

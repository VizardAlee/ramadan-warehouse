"use client";

import {
  CheckCircle2,
  PackagePlus,
  RefreshCw,
  ShoppingBasket,
  Truck,
  WalletCards,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import { useAuth } from "@/features/auth/auth-context";
import { formatNaira, nairaToKobo } from "@/features/inventory/format";
import { canSelfAuthorize, hasPermission } from "@/lib/permissions/roles";
import type {
  PurchaseOrder,
  PurchaseOrderItem,
  Supplier,
  SupplierInvoice,
} from "@/types/domain";

interface Workspace {
  suppliers: Supplier[];
  branches: Array<{
    id: string;
    name: string;
    code: string;
    branchType: "head_office" | "store";
  }>;
  warehouses: Array<{ id: string; name: string; code: string }>;
  locations: Array<{
    id: string;
    branchId?: string;
    warehouseId?: string;
    name: string;
    code: string;
  }>;
  products: Array<{
    id: string;
    name: string;
    sku: string;
    trackingType: "quantity" | "serial" | "batch";
    unitOfMeasure: string;
  }>;
  purchaseOrders: PurchaseOrder[];
  purchaseOrderItems: PurchaseOrderItem[];
  supplierInvoices: SupplierInvoice[];
  bankAccounts: Array<{
    id: string;
    bankName: string;
    accountName: string;
    accountNumberLast4: string;
    ledgerAccountCode: string;
  }>;
}
interface DraftLine {
  productId: string;
  quantity: string;
  unitCostNaira: string;
  vatPercent: string;
}
const blankLine = (): DraftLine => ({
  productId: "",
  quantity: "1",
  unitCostNaira: "",
  vatPercent: "0",
});
function procurementScopeFromKey(key: string) {
  const [type, id] = key.split(":");
  if (!id) return {};
  return type === "branch" ? { branchId: id } : { warehouseId: id };
}

export default function ProcurementPage() {
  const { user, profile, operatingContext } = useAuth();
  const newOrderRef = useRef<HTMLDetailsElement>(null);
  const newSupplierRef = useRef<HTMLDetailsElement>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [supplier, setSupplier] = useState({
    name: "",
    phone: "",
    email: "",
    paymentTermsDays: "0",
  });
  const [destinationKey, setDestinationKey] = useState("");
  const [locationId, setLocationId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([blankLine()]);
  const [receiveValues, setReceiveValues] = useState<
    Record<string, { quantity: string; serials: string; lotNumber: string }>
  >({});
  const [invoiceNumbers, setInvoiceNumbers] = useState<Record<string, string>>(
    {},
  );
  const [paymentDrafts, setPaymentDrafts] = useState<
    Record<
      string,
      {
        method: "cash" | "card" | "bank_transfer";
        bankAccountId: string;
        reference: string;
      }
    >
  >({});
  const can = (permission: Parameters<typeof hasPermission>[1]) =>
    Boolean(profile && hasPermission(profile, permission));
  const canApproveOwnWork = Boolean(profile && canSelfAuthorize(profile));
  const contextKey = operatingContext
    ? `${operatingContext.type}:${operatingContext.id}`
    : "";
  const contextScope = useMemo(
    () => procurementScopeFromKey(contextKey),
    [contextKey],
  );

  async function load() {
    if (!profile) return;
    setBusy(true);
    setError(null);
    try {
      const result = await callAdministration<
        { warehouseId?: string; branchId?: string },
        Workspace
      >("getProcurementWorkspace", contextScope);
      setWorkspace(result);
      const selectedDestination =
        contextKey ||
        destinationKey ||
        (result.branches[0] ? `branch:${result.branches[0].id}` : "");
      setDestinationKey(selectedDestination);
      const [ownerType, ownerId] = selectedDestination.split(":");
      setLocationId(
        (current) =>
          current ||
          result.locations.find(
            (location) => location[`${ownerType}Id` as "branchId" | "warehouseId"] === ownerId,
          )?.id ||
          "",
      );
      setSupplierId((current) => current || result.suppliers[0]?.id || "");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Purchasing data could not be loaded.",
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (!profile) return;
      setBusy(true);
      setError(null);
      void callAdministration<{ warehouseId?: string; branchId?: string }, Workspace>(
        "getProcurementWorkspace",
        contextScope,
      )
        .then((result) => {
          setWorkspace(result);
          const selectedDestination =
            contextKey ||
            (result.branches[0] ? `branch:${result.branches[0].id}` : "");
          setDestinationKey(selectedDestination);
          const [ownerType, ownerId] = selectedDestination.split(":");
          setLocationId(
            result.locations.find(
              (location) => location[`${ownerType}Id` as "branchId" | "warehouseId"] === ownerId,
            )?.id || "",
          );
          setSupplierId(result.suppliers[0]?.id || "");
        })
        .catch((cause) =>
          setError(
            cause instanceof Error
              ? cause.message
              : "Purchasing data could not be loaded.",
          ),
        )
        .finally(() => setBusy(false));
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [profile, contextKey, contextScope]);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      setMessage(success);
      await load();
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The operation could not be completed.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function createSupplier() {
    const created = await run(
      () =>
        callAdministration("saveSupplier", {
          name: supplier.name,
          phone: supplier.phone || undefined,
          email: supplier.email || undefined,
          paymentTermsDays: Number(supplier.paymentTermsDays),
          active: true,
          idempotencyKey: crypto.randomUUID(),
        }),
      "Supplier created and ready for purchasing.",
    );
    if (created) {
      setSupplier({ name: "", phone: "", email: "", paymentTermsDays: "0" });
      if (newSupplierRef.current) newSupplierRef.current.open = false;
    }
  }
  async function createOrder() {
    const [ownerType, ownerId] = destinationKey.split(":");
    const created = await run(
      () =>
        callAdministration("createPurchaseOrder", {
          supplierId,
          branchId: ownerType === "branch" ? ownerId : undefined,
          warehouseId: ownerType === "warehouse" ? ownerId : undefined,
          receivingLocationId: locationId,
          lines: lines.map((line) => ({
            productId: line.productId,
            quantity: Number(line.quantity),
            unitCostMinor: nairaToKobo(Number(line.unitCostNaira)),
            vatRateBasisPoints: Math.round(Number(line.vatPercent) * 100),
          })),
          idempotencyKey: crypto.randomUUID(),
        }),
      "Draft purchase order created. Review it before submission.",
    );
    if (created) {
      setLines([blankLine()]);
      if (newOrderRef.current) newOrderRef.current.open = false;
      document.getElementById("purchase-orders")?.scrollIntoView({ behavior: "smooth" });
    }
  }
  const selectedLocations =
    workspace?.locations.filter(
      (location) => {
        const [ownerType, ownerId] = destinationKey.split(":");
        return location[`${ownerType}Id` as "branchId" | "warehouseId"] === ownerId;
      },
    ) ?? [];
  const itemsByOrder = useMemo(
    () =>
      new Map(
        (workspace?.purchaseOrders ?? []).map((order) => [
          order.id,
          workspace?.purchaseOrderItems.filter(
            (item) => item.purchaseOrderId === order.id,
          ) ?? [],
        ]),
      ),
    [workspace],
  );
  if (!profile || (!can("procurement.read") && !can("payables.read")))
    return (
      <div className="rounded-xl border bg-white p-6">
        Your roles do not include purchasing or Accounts Payable access.
      </div>
    );

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-[var(--brand)]">
            Procure to pay
          </p>
          <h1 className="text-3xl font-semibold">
            Purchasing &amp; supplier accounts
          </h1>
          <p className="text-[var(--muted)]">
            Create the supplier once, record the order, receive real goods, then
            match and pay the supplier invoice. Managers can complete every step
            within their assigned Head Office or store.
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

      <nav aria-label="Purchasing workspace" className="sticky top-16 z-20 flex flex-wrap gap-2 rounded-xl border bg-white/95 p-2 shadow-sm backdrop-blur">
        <a href="#purchase-orders" className="inline-flex min-h-10 items-center rounded-lg bg-[var(--brand)] px-4 text-sm font-semibold text-white">Orders{workspace?.purchaseOrders.length ? ` (${workspace.purchaseOrders.length})` : ""}</a>
        {can("procurement.create") && <button type="button" onClick={() => { if (newOrderRef.current) { newOrderRef.current.open = true; newOrderRef.current.scrollIntoView({ behavior: "smooth" }); } }} className="inline-flex min-h-10 items-center rounded-lg border px-4 text-sm font-semibold">New order</button>}
        {can("suppliers.manage") && <button type="button" onClick={() => { if (newSupplierRef.current) { newSupplierRef.current.open = true; newSupplierRef.current.scrollIntoView({ behavior: "smooth" }); } }} className="inline-flex min-h-10 items-center rounded-lg border px-4 text-sm font-semibold">Add supplier</button>}
      </nav>

      {can("suppliers.manage") && (
        <details ref={newSupplierRef} id="new-supplier" className="scroll-mt-40 rounded-xl border bg-white p-5">
          <summary className="cursor-pointer text-lg font-semibold">
            Add supplier when needed
          </summary>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Supplier details are reused on orders, invoices, payments, and
            statements.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <label className="text-sm">
              Name
              <input
                value={supplier.name}
                onChange={(event) =>
                  setSupplier({ ...supplier, name: event.target.value })
                }
                className="mt-1 w-full rounded-lg border p-3"
              />
            </label>
            <label className="text-sm">
              Phone
              <input
                value={supplier.phone}
                onChange={(event) =>
                  setSupplier({ ...supplier, phone: event.target.value })
                }
                placeholder="07012345678"
                className="mt-1 w-full rounded-lg border p-3"
              />
            </label>
            <label className="text-sm">
              Email
              <input
                value={supplier.email}
                onChange={(event) =>
                  setSupplier({ ...supplier, email: event.target.value })
                }
                className="mt-1 w-full rounded-lg border p-3"
              />
            </label>
            <label className="text-sm">
              Payment terms (days)
              <input
                type="number"
                min="0"
                value={supplier.paymentTermsDays}
                onChange={(event) =>
                  setSupplier({
                    ...supplier,
                    paymentTermsDays: event.target.value,
                  })
                }
                className="mt-1 w-full rounded-lg border p-3"
              />
            </label>
          </div>
          <Button
            className="mt-4"
            disabled={
              busy ||
              supplier.name.trim().length < 2 ||
              (!supplier.phone && !supplier.email)
            }
            onClick={() => void createSupplier()}
          >
            Save supplier
          </Button>
        </details>
      )}

      {can("procurement.create") && workspace && (
        <details ref={newOrderRef} id="new-purchase-order" className="scroll-mt-40 rounded-xl border bg-white p-5">
          <summary className="cursor-pointer text-lg font-semibold">
            Create purchase order
          </summary>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Costs are entered in naira with two decimal places. Product names
            and tracking rules come from the catalogue.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <label className="text-sm">
              Supplier
              <select
                value={supplierId}
                onChange={(event) => setSupplierId(event.target.value)}
                className="mt-1 w-full rounded-lg border p-3"
              >
                <option value="">Select supplier</option>
                {workspace.suppliers.map((record) => (
                  <option key={record.id} value={record.id}>
                    {record.supplierNumber} · {record.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Receiving location
              <select
                value={destinationKey}
                disabled={Boolean(contextKey)}
                onChange={(event) => {
                  const key = event.target.value;
                  const [ownerType, ownerId] = key.split(":");
                  setDestinationKey(key);
                  setLocationId(
                    workspace.locations.find(
                      (location) =>
                        location[
                          `${ownerType}Id` as "branchId" | "warehouseId"
                        ] === ownerId,
                    )?.id || "",
                  );
                }}
                className="mt-1 w-full rounded-lg border p-3"
              >
                <option value="">Select receiving location</option>
                {workspace.branches.map((record) => (
                  <option key={`branch:${record.id}`} value={`branch:${record.id}`}>
                    {record.branchType === "head_office"
                      ? "Head Office"
                      : "Store"}{" "}
                    · {record.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Stock location
              <select
                value={locationId}
                onChange={(event) => setLocationId(event.target.value)}
                className="mt-1 w-full rounded-lg border p-3"
              >
                <option value="">Select receiving location</option>
                {selectedLocations.map((record) => (
                  <option key={record.id} value={record.id}>
                    {record.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-4 space-y-3">
            {lines.map((line, index) => (
              <fieldset
                key={index}
                className="grid gap-3 rounded-xl border p-3 md:grid-cols-[minmax(0,1fr)_7rem_10rem_7rem_auto]"
              >
                <legend className="px-1 text-xs font-semibold text-[var(--muted)]">
                  Product line {index + 1}
                </legend>
                <label className="text-sm font-medium">
                  Product
                  <select
                    value={line.productId}
                    onChange={(event) =>
                      setLines(
                        lines.map((current, currentIndex) =>
                          currentIndex === index
                            ? { ...current, productId: event.target.value }
                            : current,
                        ),
                      )
                    }
                    className="mt-1 w-full rounded-lg border p-3"
                  >
                    <option value="">Select product</option>
                    {workspace.products.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.sku} · {product.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-medium">
                  Quantity
                  <input
                    type="number"
                    min="1"
                    value={line.quantity}
                    onChange={(event) =>
                      setLines(
                        lines.map((current, currentIndex) =>
                          currentIndex === index
                            ? { ...current, quantity: event.target.value }
                            : current,
                        ),
                      )
                    }
                    className="mt-1 w-full rounded-lg border p-3"
                  />
                </label>
                <label className="text-sm font-medium">
                  Unit cost (₦)
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={line.unitCostNaira}
                    onChange={(event) =>
                      setLines(
                        lines.map((current, currentIndex) =>
                          currentIndex === index
                            ? { ...current, unitCostNaira: event.target.value }
                            : current,
                        ),
                      )
                    }
                    className="mt-1 w-full rounded-lg border p-3"
                  />
                </label>
                <label className="text-sm font-medium">
                  VAT (%)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={line.vatPercent}
                    onChange={(event) =>
                      setLines(
                        lines.map((current, currentIndex) =>
                          currentIndex === index
                            ? { ...current, vatPercent: event.target.value }
                            : current,
                        ),
                      )
                    }
                    className="mt-1 w-full rounded-lg border p-3"
                  />
                </label>
                <Button
                  variant="outline"
                  className="self-end"
                  disabled={lines.length === 1}
                  onClick={() =>
                    setLines(
                      lines.filter((_, currentIndex) => currentIndex !== index),
                    )
                  }
                >
                  Remove
                </Button>
              </fieldset>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button
              variant="outline"
              onClick={() => setLines([...lines, blankLine()])}
            >
              Add product
            </Button>
            <Button
              disabled={
                busy ||
                !supplierId ||
                !destinationKey ||
                !locationId ||
                lines.some(
                  (line) =>
                    !line.productId ||
                    !line.unitCostNaira ||
                    Number(line.quantity) <= 0,
                )
              }
              onClick={() => void createOrder()}
            >
              <ShoppingBasket className="mr-2 size-4" /> Create draft order
            </Button>
          </div>
        </details>
      )}

      <section id="purchase-orders" className="scroll-mt-40 rounded-xl border bg-white p-5">
        <h2 className="text-xl font-semibold">Purchase orders</h2>
        <p className="text-sm text-[var(--muted)]">
          Submission freezes the commercial snapshot. An assigned manager may
          approve their own order; every decision remains in the audit trail.
        </p>
        <p className="mt-3 rounded-lg bg-indigo-50 p-3 text-sm text-[var(--brand-dark)]">
          Follow each order here: create → approve → receive goods → match invoice → pay. Only the next available actions appear on each order.
        </p>
        <div className="mt-4 space-y-4">
          {workspace?.purchaseOrders.map((order) => (
            <article key={order.id} className="rounded-xl border p-4">
              <div className="flex flex-col justify-between gap-3 sm:flex-row">
                <div>
                  <strong>{order.purchaseOrderNumber}</strong>
                  <p className="text-sm text-[var(--muted)]">
                    {order.supplierName} → {order.operationalLocationName ?? order.branchName ?? order.warehouseName}
                  </p>
                  <p className="mt-1 text-sm">
                    {formatNaira(order.grossAmountMinor)} ·{" "}
                    <span className="capitalize">
                      {order.status.replaceAll("_", " ")}
                    </span>
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {order.status === "draft" && can("procurement.create") && (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () =>
                            callAdministration("submitPurchaseOrder", {
                              purchaseOrderId: order.id,
                              idempotencyKey: crypto.randomUUID(),
                            }),
                          `${order.purchaseOrderNumber} submitted for approval.`,
                        )
                      }
                    >
                      Submit
                    </Button>
                  )}
                  {order.status === "submitted" &&
                    can("procurement.approve") &&
                    (order.createdBy !== user?.uid || canApproveOwnWork) && (
                      <Button
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () =>
                              callAdministration("approvePurchaseOrder", {
                                purchaseOrderId: order.id,
                                idempotencyKey: crypto.randomUUID(),
                              }),
                            `${order.purchaseOrderNumber} approved for receiving.`,
                          )
                        }
                      >
                        <CheckCircle2 className="mr-2 size-4" /> Approve
                      </Button>
                    )}
                  {order.status === "submitted" &&
                    order.createdBy === user?.uid &&
                    !canApproveOwnWork && (
                      <span className="text-xs text-amber-800">
                        This role requires another approver
                      </span>
                    )}
                </div>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {(itemsByOrder.get(order.id) ?? []).map((item) => {
                  const outstanding =
                    item.orderedQuantity - item.receivedQuantity;
                  const draft = receiveValues[item.id] ?? {
                    quantity: String(outstanding),
                    serials: "",
                    lotNumber: "",
                  };
                  return (
                    <div key={item.id} className="rounded-lg bg-slate-50 p-3">
                      <strong className="text-sm">{item.productName}</strong>
                      <p className="text-xs text-[var(--muted)]">
                        {item.sku} · ordered {item.orderedQuantity} · received{" "}
                        {item.receivedQuantity}
                      </p>
                      {outstanding > 0 &&
                        ["approved", "partially_received"].includes(
                          order.status,
                        ) &&
                        can("procurement.receive") && (
                          <div className="mt-3 space-y-2">
                            <label className="block text-xs font-medium">
                              Quantity received
                              <input
                                type="number"
                                min="1"
                                max={outstanding}
                                value={draft.quantity}
                                onChange={(event) =>
                                  setReceiveValues({
                                    ...receiveValues,
                                    [item.id]: {
                                      ...draft,
                                      quantity: event.target.value,
                                    },
                                  })
                                }
                                className="mt-1 w-full rounded-lg border bg-white p-2"
                              />
                            </label>
                            {item.trackingType === "serial" && (
                              <textarea
                                value={draft.serials}
                                onChange={(event) =>
                                  setReceiveValues({
                                    ...receiveValues,
                                    [item.id]: {
                                      ...draft,
                                      serials: event.target.value,
                                    },
                                  })
                                }
                                placeholder="One serial number per line"
                                className="w-full rounded-lg border bg-white p-2"
                              />
                            )}
                            {item.trackingType === "batch" && (
                              <input
                                value={draft.lotNumber}
                                onChange={(event) =>
                                  setReceiveValues({
                                    ...receiveValues,
                                    [item.id]: {
                                      ...draft,
                                      lotNumber: event.target.value,
                                    },
                                  })
                                }
                                placeholder="Supplier lot number"
                                className="w-full rounded-lg border bg-white p-2"
                              />
                            )}
                            <Button
                              size="sm"
                              disabled={
                                busy ||
                                Number(draft.quantity) <= 0 ||
                                Number(draft.quantity) > outstanding ||
                                (item.trackingType === "batch" &&
                                  !draft.lotNumber)
                              }
                              onClick={() =>
                                void run(
                                  () =>
                                    callAdministration(
                                      "receivePurchaseOrderItem",
                                      {
                                        purchaseOrderId: order.id,
                                        purchaseOrderItemId: item.id,
                                        quantity: Number(draft.quantity),
                                        receivedAt: new Date().toISOString(),
                                        serialNumbers: draft.serials
                                          .split(/\r?\n|,/)
                                          .map((value) => value.trim())
                                          .filter(Boolean),
                                        lot:
                                          item.trackingType === "batch"
                                            ? { lotNumber: draft.lotNumber }
                                            : undefined,
                                        idempotencyKey: crypto.randomUUID(),
                                      },
                                    ),
                                  `${draft.quantity} ${item.unitOfMeasure} received into ${order.operationalLocationName ?? order.branchName ?? order.warehouseName}.`,
                                )
                              }
                            >
                              <Truck className="mr-2 size-4" /> Receive goods
                            </Button>
                          </div>
                        )}
                    </div>
                  );
                })}
              </div>
              {can("payables.create") &&
                ["partially_received", "received"].includes(order.status) && (
                  <div className="mt-4 flex flex-col gap-2 border-t pt-4 sm:flex-row">
                    <input
                      value={invoiceNumbers[order.id] ?? ""}
                      onChange={(event) =>
                        setInvoiceNumbers({
                          ...invoiceNumbers,
                          [order.id]: event.target.value,
                        })
                      }
                      placeholder="Supplier invoice number"
                      className="min-h-10 flex-1 rounded-lg border px-3"
                    />
                    <Button
                      disabled={
                        busy ||
                        !(invoiceNumbers[order.id] ?? "").trim() ||
                        !(itemsByOrder.get(order.id) ?? []).some(
                          (item) =>
                            item.receivedQuantity >
                            (item.invoicedQuantity ?? 0),
                        )
                      }
                      onClick={() =>
                        void run(
                          () =>
                            callAdministration("submitSupplierInvoice", {
                              purchaseOrderId: order.id,
                              supplierInvoiceNumber: invoiceNumbers[order.id],
                              invoiceDate: new Date()
                                .toISOString()
                                .slice(0, 10),
                              lines: (itemsByOrder.get(order.id) ?? [])
                                .filter(
                                  (item) =>
                                    item.receivedQuantity >
                                    (item.invoicedQuantity ?? 0),
                                )
                                .map((item) => ({
                                  purchaseOrderItemId: item.id,
                                  quantity:
                                    item.receivedQuantity -
                                    (item.invoicedQuantity ?? 0),
                                })),
                              idempotencyKey: crypto.randomUUID(),
                            }),
                          `Invoice ${invoiceNumbers[order.id]} submitted for approval.`,
                        )
                      }
                    >
                      <PackagePlus className="mr-2 size-4" /> Match received
                      goods to invoice
                    </Button>
                  </div>
                )}
            </article>
          ))}
          {!workspace?.purchaseOrders.length && (
            <p className="rounded-lg bg-slate-50 p-6 text-center text-sm text-[var(--muted)]">
              No purchase orders yet.
            </p>
          )}
        </div>
      </section>

      {can("payables.read") && (
        <section className="rounded-xl border bg-white p-5">
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            <WalletCards className="size-5" /> Accounts Payable
          </h2>
          <p className="text-sm text-[var(--muted)]">
            Only received, matched quantities become payable. Assigned managers
            may approve their own matched invoice; every action is audited.
          </p>
          <div className="mt-4 space-y-3">
            {workspace?.supplierInvoices.map((invoice) => {
              const payment = paymentDrafts[invoice.id] ?? {
                method: "bank_transfer" as const,
                bankAccountId: "",
                reference: "",
              };
              return (
              <article
                key={invoice.id}
                className="flex flex-col justify-between gap-3 rounded-xl border p-4 lg:flex-row lg:items-center"
              >
                <div>
                  <strong>{invoice.supplierInvoiceNumber}</strong>
                  <p className="text-sm text-[var(--muted)]">
                    {invoice.supplierName} · {invoice.purchaseOrderNumber}
                  </p>
                  <p className="mt-1 text-sm">
                    Outstanding {formatNaira(invoice.outstandingAmountMinor)} ·{" "}
                    <span className="capitalize">
                      {invoice.status.replaceAll("_", " ")}
                    </span>
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  {invoice.status === "submitted" &&
                    can("payables.approve") &&
                    (invoice.createdBy !== user?.uid || canApproveOwnWork) && (
                      <Button
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () =>
                              callAdministration("approveSupplierInvoice", {
                                supplierInvoiceId: invoice.id,
                                idempotencyKey: crypto.randomUUID(),
                              }),
                            `Invoice ${invoice.supplierInvoiceNumber} approved and posted to Accounts Payable.`,
                          )
                        }
                      >
                        Approve invoice
                      </Button>
                    )}
                  {invoice.status === "submitted" &&
                    invoice.createdBy === user?.uid &&
                    !canApproveOwnWork && (
                      <span className="text-xs text-amber-800">
                        This role requires another finance approver
                      </span>
                    )}
                  {["approved", "partially_paid"].includes(invoice.status) &&
                    can("payables.pay") && (
                      <>
                        <select
                          aria-label="Supplier payment method"
                          value={payment.method}
                          onChange={(event) =>
                            setPaymentDrafts({
                              ...paymentDrafts,
                              [invoice.id]: {
                                ...payment,
                                method: event.target.value as typeof payment.method,
                                bankAccountId:
                                  event.target.value === "cash"
                                    ? ""
                                    : payment.bankAccountId,
                              },
                            })
                          }
                          className="min-h-10 rounded-lg border px-3"
                        >
                          <option value="bank_transfer">Bank transfer</option>
                          <option value="card">Card / POS</option>
                          <option value="cash">Cash</option>
                        </select>
                        <select
                          aria-label="Company bank account"
                          value={payment.bankAccountId}
                          disabled={payment.method === "cash"}
                          onChange={(event) =>
                            setPaymentDrafts({
                              ...paymentDrafts,
                              [invoice.id]: {
                                ...payment,
                                bankAccountId: event.target.value,
                              },
                            })
                          }
                          className="min-h-10 rounded-lg border px-3 disabled:bg-slate-100"
                        >
                          <option value="">
                            {payment.method === "cash"
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
                          value={payment.reference}
                          onChange={(event) =>
                            setPaymentDrafts({
                              ...paymentDrafts,
                              [invoice.id]: {
                                ...payment,
                                reference: event.target.value,
                              },
                            })
                          }
                          placeholder={
                            payment.method === "cash"
                              ? "Reference (optional)"
                              : "Payment reference"
                          }
                          className="min-h-10 rounded-lg border px-3"
                        />
                        <Button
                          disabled={
                            busy ||
                            (payment.method !== "cash" &&
                              (!payment.reference.trim() ||
                                !payment.bankAccountId))
                          }
                          onClick={() =>
                            void run(
                              () =>
                                callAdministration("recordSupplierPayment", {
                                  supplierId: invoice.supplierId,
                                  method: payment.method,
                                  bankAccountId:
                                    payment.bankAccountId || undefined,
                                  reference:
                                    payment.reference || undefined,
                                  allocations: [
                                    {
                                      supplierInvoiceId: invoice.id,
                                      amountMinor:
                                        invoice.outstandingAmountMinor,
                                    },
                                  ],
                                  paidAt: new Date().toISOString(),
                                  idempotencyKey: crypto.randomUUID(),
                                }),
                              `Payment recorded against ${invoice.supplierInvoiceNumber}.`,
                            )
                          }
                        >
                          Pay outstanding
                        </Button>
                      </>
                    )}
                </div>
              </article>
              );
            })}
            {!workspace?.supplierInvoices.length && (
              <p className="rounded-lg bg-slate-50 p-6 text-center text-sm text-[var(--muted)]">
                No supplier invoices recorded.
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

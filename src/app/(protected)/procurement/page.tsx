"use client";

import { CheckCircle2, PackagePlus, RefreshCw, ShoppingBasket, Truck, WalletCards } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import { useAuth } from "@/features/auth/auth-context";
import { formatNaira, nairaToKobo } from "@/features/inventory/format";
import { hasPermission } from "@/lib/permissions/roles";
import type { PurchaseOrder, PurchaseOrderItem, Supplier, SupplierInvoice } from "@/types/domain";

interface Workspace {
  suppliers: Supplier[];
  warehouses: Array<{ id: string; name: string; code: string }>;
  locations: Array<{ id: string; warehouseId: string; name: string; code: string }>;
  products: Array<{ id: string; name: string; sku: string; trackingType: "quantity" | "serial" | "batch"; unitOfMeasure: string }>;
  purchaseOrders: PurchaseOrder[];
  purchaseOrderItems: PurchaseOrderItem[];
  supplierInvoices: SupplierInvoice[];
}
interface DraftLine { productId: string; quantity: string; unitCostNaira: string; vatPercent: string }
const blankLine = (): DraftLine => ({ productId: "", quantity: "1", unitCostNaira: "", vatPercent: "0" });

export default function ProcurementPage() {
  const { user, profile, operatingContext } = useAuth();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [supplier, setSupplier] = useState({ name: "", phone: "", email: "", paymentTermsDays: "0" });
  const [warehouseId, setWarehouseId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([blankLine()]);
  const [receiveValues, setReceiveValues] = useState<Record<string, { quantity: string; serials: string; lotNumber: string }>>({});
  const [invoiceNumbers, setInvoiceNumbers] = useState<Record<string, string>>({});
  const [paymentReferences, setPaymentReferences] = useState<Record<string, string>>({});
  const can = (permission: Parameters<typeof hasPermission>[1]) => Boolean(profile && hasPermission(profile, permission));
  const contextWarehouseId = operatingContext?.type === "warehouse" ? operatingContext.id : "";

  async function load() {
    if (!profile) return;
    setBusy(true); setError(null);
    try {
      const result = await callAdministration<{ warehouseId?: string }, Workspace>("getProcurementWorkspace", { warehouseId: contextWarehouseId || undefined });
      setWorkspace(result);
      const selectedWarehouse = contextWarehouseId || warehouseId || result.warehouses[0]?.id || "";
      setWarehouseId(selectedWarehouse);
      setLocationId((current) => current || result.locations.find((location) => location.warehouseId === selectedWarehouse)?.id || "");
      setSupplierId((current) => current || result.suppliers[0]?.id || "");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Purchasing data could not be loaded."); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (!profile) return;
      setBusy(true); setError(null);
      void callAdministration<{ warehouseId?: string }, Workspace>("getProcurementWorkspace", { warehouseId: contextWarehouseId || undefined })
        .then((result) => {
          setWorkspace(result);
          const selectedWarehouse = contextWarehouseId || result.warehouses[0]?.id || "";
          setWarehouseId(selectedWarehouse);
          setLocationId(result.locations.find((location) => location.warehouseId === selectedWarehouse)?.id || "");
          setSupplierId(result.suppliers[0]?.id || "");
        })
        .catch((cause) => setError(cause instanceof Error ? cause.message : "Purchasing data could not be loaded."))
        .finally(() => setBusy(false));
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [profile, contextWarehouseId]);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true); setError(null); setMessage(null);
    try { await action(); setMessage(success); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The operation could not be completed."); }
    finally { setBusy(false); }
  }
  async function createSupplier() {
    await run(() => callAdministration("saveSupplier", { name: supplier.name, phone: supplier.phone || undefined, email: supplier.email || undefined, paymentTermsDays: Number(supplier.paymentTermsDays), active: true, idempotencyKey: crypto.randomUUID() }), "Supplier created and ready for purchasing.");
    setSupplier({ name: "", phone: "", email: "", paymentTermsDays: "0" });
  }
  async function createOrder() {
    await run(() => callAdministration("createPurchaseOrder", {
      supplierId, warehouseId, receivingLocationId: locationId,
      lines: lines.map((line) => ({ productId: line.productId, quantity: Number(line.quantity), unitCostMinor: nairaToKobo(Number(line.unitCostNaira)), vatRateBasisPoints: Math.round(Number(line.vatPercent) * 100) })),
      idempotencyKey: crypto.randomUUID(),
    }), "Draft purchase order created. Review it before submission.");
    setLines([blankLine()]);
  }
  const selectedLocations = workspace?.locations.filter((location) => location.warehouseId === warehouseId) ?? [];
  const itemsByOrder = useMemo(() => new Map((workspace?.purchaseOrders ?? []).map((order) => [order.id, workspace?.purchaseOrderItems.filter((item) => item.purchaseOrderId === order.id) ?? []])), [workspace]);
  if (!profile || (!can("procurement.read") && !can("payables.read"))) return <div className="rounded-xl border bg-white p-6">Your roles do not include purchasing or Accounts Payable access.</div>;

  return <div className="space-y-5">
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[.16em] text-[var(--brand)]">Procure to pay</p><h1 className="text-3xl font-semibold">Purchasing &amp; supplier accounts</h1><p className="text-[var(--muted)]">Create the supplier once, approve the order independently, receive real goods, then approve and pay only matched invoices.</p></div><Button variant="outline" disabled={busy} onClick={() => void load()}><RefreshCw className="mr-2 size-4" /> Refresh</Button></header>
    {error && <div role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</div>}{message && <div role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">{message}</div>}

    {can("suppliers.manage") && <details className="rounded-xl border bg-white p-5"><summary className="cursor-pointer text-lg font-semibold">1. Add supplier</summary><p className="mt-1 text-sm text-[var(--muted)]">Supplier details are reused on orders, invoices, payments, and statements.</p><div className="mt-4 grid gap-3 md:grid-cols-4"><label className="text-sm">Name<input value={supplier.name} onChange={(event) => setSupplier({ ...supplier, name: event.target.value })} className="mt-1 w-full rounded-lg border p-3" /></label><label className="text-sm">Phone<input value={supplier.phone} onChange={(event) => setSupplier({ ...supplier, phone: event.target.value })} placeholder="07012345678" className="mt-1 w-full rounded-lg border p-3" /></label><label className="text-sm">Email<input value={supplier.email} onChange={(event) => setSupplier({ ...supplier, email: event.target.value })} className="mt-1 w-full rounded-lg border p-3" /></label><label className="text-sm">Payment terms (days)<input type="number" min="0" value={supplier.paymentTermsDays} onChange={(event) => setSupplier({ ...supplier, paymentTermsDays: event.target.value })} className="mt-1 w-full rounded-lg border p-3" /></label></div><Button className="mt-4" disabled={busy || supplier.name.trim().length < 2 || (!supplier.phone && !supplier.email)} onClick={() => void createSupplier()}>Save supplier</Button></details>}

    {can("procurement.create") && workspace && <details open className="rounded-xl border bg-white p-5"><summary className="cursor-pointer text-lg font-semibold">2. Create purchase order</summary><p className="mt-1 text-sm text-[var(--muted)]">Costs are entered in naira with two decimal places. Product names and tracking rules come from the catalogue.</p><div className="mt-4 grid gap-3 md:grid-cols-3"><label className="text-sm">Supplier<select value={supplierId} onChange={(event) => setSupplierId(event.target.value)} className="mt-1 w-full rounded-lg border p-3"><option value="">Select supplier</option>{workspace.suppliers.map((record) => <option key={record.id} value={record.id}>{record.supplierNumber} · {record.name}</option>)}</select></label><label className="text-sm">Receiving warehouse<select value={warehouseId} disabled={Boolean(contextWarehouseId)} onChange={(event) => { const id = event.target.value; setWarehouseId(id); setLocationId(workspace.locations.find((location) => location.warehouseId === id)?.id || ""); }} className="mt-1 w-full rounded-lg border p-3"><option value="">Select warehouse</option>{workspace.warehouses.map((record) => <option key={record.id} value={record.id}>{record.name}</option>)}</select></label><label className="text-sm">Stock location<select value={locationId} onChange={(event) => setLocationId(event.target.value)} className="mt-1 w-full rounded-lg border p-3"><option value="">Select receiving location</option>{selectedLocations.map((record) => <option key={record.id} value={record.id}>{record.name}</option>)}</select></label></div><div className="mt-4 space-y-3">{lines.map((line, index) => <div key={index} className="grid gap-3 rounded-xl border p-3 md:grid-cols-[minmax(0,1fr)_7rem_10rem_7rem_auto]"><select value={line.productId} onChange={(event) => setLines(lines.map((current, currentIndex) => currentIndex === index ? { ...current, productId: event.target.value } : current))} className="rounded-lg border p-3"><option value="">Select product</option>{workspace.products.map((product) => <option key={product.id} value={product.id}>{product.sku} · {product.name}</option>)}</select><input aria-label="Quantity" type="number" min="1" value={line.quantity} onChange={(event) => setLines(lines.map((current, currentIndex) => currentIndex === index ? { ...current, quantity: event.target.value } : current))} className="rounded-lg border p-3" /><input aria-label="Unit cost in naira" type="number" min="0.01" step="0.01" placeholder="Unit cost ₦" value={line.unitCostNaira} onChange={(event) => setLines(lines.map((current, currentIndex) => currentIndex === index ? { ...current, unitCostNaira: event.target.value } : current))} className="rounded-lg border p-3" /><input aria-label="VAT percent" type="number" min="0" step="0.01" placeholder="VAT %" value={line.vatPercent} onChange={(event) => setLines(lines.map((current, currentIndex) => currentIndex === index ? { ...current, vatPercent: event.target.value } : current))} className="rounded-lg border p-3" /><Button variant="outline" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, currentIndex) => currentIndex !== index))}>Remove</Button></div>)}</div><div className="mt-4 flex flex-wrap gap-3"><Button variant="outline" onClick={() => setLines([...lines, blankLine()])}>Add product</Button><Button disabled={busy || !supplierId || !warehouseId || !locationId || lines.some((line) => !line.productId || !line.unitCostNaira || Number(line.quantity) <= 0)} onClick={() => void createOrder()}><ShoppingBasket className="mr-2 size-4" /> Create draft order</Button></div></details>}

    <section className="rounded-xl border bg-white p-5"><h2 className="text-xl font-semibold">Purchase orders</h2><p className="text-sm text-[var(--muted)]">Submission freezes the commercial snapshot. The creator cannot approve their own order.</p><div className="mt-4 space-y-4">{workspace?.purchaseOrders.map((order) => <article key={order.id} className="rounded-xl border p-4"><div className="flex flex-col justify-between gap-3 sm:flex-row"><div><strong>{order.purchaseOrderNumber}</strong><p className="text-sm text-[var(--muted)]">{order.supplierName} → {order.warehouseName}</p><p className="mt-1 text-sm">{formatNaira(order.grossAmountMinor)} · <span className="capitalize">{order.status.replaceAll("_", " ")}</span></p></div><div className="flex flex-wrap gap-2">{order.status === "draft" && can("procurement.create") && <Button disabled={busy} onClick={() => void run(() => callAdministration("submitPurchaseOrder", { purchaseOrderId: order.id, idempotencyKey: crypto.randomUUID() }), `${order.purchaseOrderNumber} submitted for independent approval.`)}>Submit</Button>}{order.status === "submitted" && can("procurement.approve") && order.createdBy !== user?.uid && <Button disabled={busy} onClick={() => void run(() => callAdministration("approvePurchaseOrder", { purchaseOrderId: order.id, idempotencyKey: crypto.randomUUID() }), `${order.purchaseOrderNumber} approved for receiving.`)}><CheckCircle2 className="mr-2 size-4" /> Approve</Button>}{order.status === "submitted" && order.createdBy === user?.uid && <span className="text-xs text-amber-800">Another authorized user must approve</span>}</div></div><div className="mt-4 grid gap-3 md:grid-cols-2">{(itemsByOrder.get(order.id) ?? []).map((item) => { const outstanding = item.orderedQuantity - item.receivedQuantity; const draft = receiveValues[item.id] ?? { quantity: String(outstanding), serials: "", lotNumber: "" }; return <div key={item.id} className="rounded-lg bg-slate-50 p-3"><strong className="text-sm">{item.productName}</strong><p className="text-xs text-[var(--muted)]">{item.sku} · ordered {item.orderedQuantity} · received {item.receivedQuantity}</p>{outstanding > 0 && ["approved", "partially_received"].includes(order.status) && can("procurement.receive") && <div className="mt-3 space-y-2"><input type="number" min="1" max={outstanding} value={draft.quantity} onChange={(event) => setReceiveValues({ ...receiveValues, [item.id]: { ...draft, quantity: event.target.value } })} className="w-full rounded-lg border bg-white p-2" />{item.trackingType === "serial" && <textarea value={draft.serials} onChange={(event) => setReceiveValues({ ...receiveValues, [item.id]: { ...draft, serials: event.target.value } })} placeholder="One serial number per line" className="w-full rounded-lg border bg-white p-2" />}{item.trackingType === "batch" && <input value={draft.lotNumber} onChange={(event) => setReceiveValues({ ...receiveValues, [item.id]: { ...draft, lotNumber: event.target.value } })} placeholder="Supplier lot number" className="w-full rounded-lg border bg-white p-2" />}<Button size="sm" disabled={busy || Number(draft.quantity) <= 0 || Number(draft.quantity) > outstanding || (item.trackingType === "batch" && !draft.lotNumber)} onClick={() => void run(() => callAdministration("receivePurchaseOrderItem", { purchaseOrderId: order.id, purchaseOrderItemId: item.id, quantity: Number(draft.quantity), receivedAt: new Date().toISOString(), serialNumbers: draft.serials.split(/\r?\n|,/).map((value) => value.trim()).filter(Boolean), lot: item.trackingType === "batch" ? { lotNumber: draft.lotNumber } : undefined, idempotencyKey: crypto.randomUUID() }), `${draft.quantity} ${item.unitOfMeasure} received into ${order.warehouseName}.`)}><Truck className="mr-2 size-4" /> Receive goods</Button></div>}</div>; })}</div>{can("payables.create") && ["partially_received", "received"].includes(order.status) && <div className="mt-4 flex flex-col gap-2 border-t pt-4 sm:flex-row"><input value={invoiceNumbers[order.id] ?? ""} onChange={(event) => setInvoiceNumbers({ ...invoiceNumbers, [order.id]: event.target.value })} placeholder="Supplier invoice number" className="min-h-10 flex-1 rounded-lg border px-3" /><Button disabled={busy || !(invoiceNumbers[order.id] ?? "").trim() || !(itemsByOrder.get(order.id) ?? []).some((item) => item.receivedQuantity > (item.invoicedQuantity ?? 0))} onClick={() => void run(() => callAdministration("submitSupplierInvoice", { purchaseOrderId: order.id, supplierInvoiceNumber: invoiceNumbers[order.id], invoiceDate: new Date().toISOString().slice(0, 10), lines: (itemsByOrder.get(order.id) ?? []).filter((item) => item.receivedQuantity > (item.invoicedQuantity ?? 0)).map((item) => ({ purchaseOrderItemId: item.id, quantity: item.receivedQuantity - (item.invoicedQuantity ?? 0) })), idempotencyKey: crypto.randomUUID() }), `Invoice ${invoiceNumbers[order.id]} submitted for independent finance approval.`)}><PackagePlus className="mr-2 size-4" /> Match received goods to invoice</Button></div>}</article>)}{!workspace?.purchaseOrders.length && <p className="rounded-lg bg-slate-50 p-6 text-center text-sm text-[var(--muted)]">No purchase orders yet.</p>}</div></section>

    {can("payables.read") && <section className="rounded-xl border bg-white p-5"><h2 className="flex items-center gap-2 text-xl font-semibold"><WalletCards className="size-5" /> Accounts Payable</h2><p className="text-sm text-[var(--muted)]">Only received, matched quantities become payable. Invoice creator and approver must differ.</p><div className="mt-4 space-y-3">{workspace?.supplierInvoices.map((invoice) => <article key={invoice.id} className="flex flex-col justify-between gap-3 rounded-xl border p-4 lg:flex-row lg:items-center"><div><strong>{invoice.supplierInvoiceNumber}</strong><p className="text-sm text-[var(--muted)]">{invoice.supplierName} · {invoice.purchaseOrderNumber}</p><p className="mt-1 text-sm">Outstanding {formatNaira(invoice.outstandingAmountMinor)} · <span className="capitalize">{invoice.status.replaceAll("_", " ")}</span></p></div><div className="flex flex-col gap-2 sm:flex-row">{invoice.status === "submitted" && can("payables.approve") && invoice.createdBy !== user?.uid && <Button disabled={busy} onClick={() => void run(() => callAdministration("approveSupplierInvoice", { supplierInvoiceId: invoice.id, idempotencyKey: crypto.randomUUID() }), `Invoice ${invoice.supplierInvoiceNumber} approved and posted to Accounts Payable.`)}>Approve invoice</Button>}{invoice.status === "submitted" && invoice.createdBy === user?.uid && <span className="text-xs text-amber-800">Another finance approver is required</span>}{["approved", "partially_paid"].includes(invoice.status) && can("payables.pay") && <><input value={paymentReferences[invoice.id] ?? ""} onChange={(event) => setPaymentReferences({ ...paymentReferences, [invoice.id]: event.target.value })} placeholder="Bank payment reference" className="min-h-10 rounded-lg border px-3" /><Button disabled={busy || !(paymentReferences[invoice.id] ?? "").trim()} onClick={() => void run(() => callAdministration("recordSupplierPayment", { supplierId: invoice.supplierId, method: "bank_transfer", reference: paymentReferences[invoice.id], allocations: [{ supplierInvoiceId: invoice.id, amountMinor: invoice.outstandingAmountMinor }], paidAt: new Date().toISOString(), idempotencyKey: crypto.randomUUID() }), `Payment recorded against ${invoice.supplierInvoiceNumber}.`)}>Pay outstanding</Button></>}</div></article>)}{!workspace?.supplierInvoices.length && <p className="rounded-lg bg-slate-50 p-6 text-center text-sm text-[var(--muted)]">No supplier invoices recorded.</p>}</div></section>}
  </div>;
}

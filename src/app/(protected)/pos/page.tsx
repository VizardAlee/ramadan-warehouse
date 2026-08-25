"use client";

import {
  Banknote,
  CheckCircle2,
  CircleAlert,
  Minus,
  Plus,
  Printer,
  RefreshCw,
  Search,
  ShoppingCart,
  WifiOff,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import { useOrganizationCollection } from "@/features/administration/use-organization-collection";
import { useAuth } from "@/features/auth/auth-context";
import { calculatePosCart, provisionalReceiptReference } from "@/features/pos/calculations";
import {
  listQueuedSales,
  queueOfflineSale,
  readCachedWorkspace,
  removeQueuedSale,
  saveCachedWorkspace,
  updateQueuedSale,
} from "@/features/pos/offline-store";
import type {
  PosCartLine,
  PosPaymentMethod,
  PosSalePayload,
  PosWorkspace,
  QueuedPosSale,
} from "@/features/pos/types";
import { formatNaira, nairaToKobo } from "@/features/inventory/format";
import { useConnectivity } from "@/lib/connectivity";
import { hasPermission } from "@/lib/permissions/roles";
import type { Branch } from "@/types/domain";

interface SaleResult {
  saleId: string;
  saleNumber: string;
  receiptNumber: string;
  posted: boolean;
}

function deviceIdentity() {
  const key = "abr-pos-device-id";
  let value = window.localStorage.getItem(key);
  if (!value) {
    value = crypto.randomUUID();
    window.localStorage.setItem(key, value);
  }
  return value;
}

export default function PosPage() {
  const { user, profile, accessProfile, operatingContext } = useAuth();
  const { online } = useConnectivity();
  const branches = useOrganizationCollection<Branch>("branches");
  const [manualBranchId, setManualBranchId] = useState("");
  const [workspace, setWorkspace] = useState<PosWorkspace | null>(null);
  const [cart, setCart] = useState<PosCartLine[]>([]);
  const [queued, setQueued] = useState<QueuedPosSale[]>([]);
  const [search, setSearch] = useState("");
  const [paymentMethod, setPaymentMethod] =
    useState<PosPaymentMethod>("cash");
  const [paymentReference, setPaymentReference] = useState("");
  const [openingCash, setOpeningCash] = useState("0.00");
  const [closingCash, setClosingCash] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<{
    reference: string;
    totalMinor: number;
    queued: boolean;
  } | null>(null);
  const [priceProductId, setPriceProductId] = useState<string | null>(null);
  const [branchPrice, setBranchPrice] = useState("");
  const [priceReason, setPriceReason] = useState("");
  const branchContextId =
    operatingContext?.type === "branch" ? operatingContext.id : undefined;
  const assignedBranchId =
    accessProfile?.branchIds.length === 1
      ? accessProfile.branchIds[0]
      : undefined;
  const firstActiveBranchId = branches.data.find(
    (branch) => branch.status === "active",
  )?.id;
  const selectedBranchId =
    branchContextId ??
    assignedBranchId ??
    (manualBranchId || firstActiveBranchId || "");
  const canSell = Boolean(profile && hasPermission(profile, "sales.create"));
  const canManageBranchPrice = Boolean(
    profile && hasPermission(profile, "sales.price.branch.manage"),
  );
  const totals = useMemo(() => calculatePosCart(cart), [cart]);

  useEffect(() => {
    if ("serviceWorker" in navigator)
      void navigator.serviceWorker.register("/sw.js");
  }, []);

  const refreshQueue = useCallback(async () => {
    if (!selectedBranchId || !user) return;
    setQueued(await listQueuedSales(selectedBranchId, user.uid));
  }, [selectedBranchId, user]);

  const loadWorkspace = useCallback(async () => {
    if (!selectedBranchId || !user) return;
    setBusy(true);
    setError(null);
    try {
      if (online) {
        const result = await callAdministration<{ branchId: string }, PosWorkspace>(
          "getPosWorkspace",
          { branchId: selectedBranchId },
        );
        setWorkspace(result);
        await saveCachedWorkspace(user.uid, result);
      } else {
        const cached = await readCachedWorkspace(user.uid, selectedBranchId);
        if (!cached)
          throw new Error(
            "This branch POS must be opened online once before it can sell offline.",
          );
        setWorkspace(cached);
        setMessage(
          `Offline catalogue loaded from ${new Date(cached.refreshedAt).toLocaleString("en-NG")}.`,
        );
      }
      await refreshQueue();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load this branch POS.");
    } finally {
      setBusy(false);
    }
  }, [online, refreshQueue, selectedBranchId, user]);

  useEffect(() => {
    if (!selectedBranchId) return;
    const timeout = window.setTimeout(() => void loadWorkspace(), 0);
    return () => window.clearTimeout(timeout);
  }, [selectedBranchId, loadWorkspace]);

  const syncQueue = useCallback(async () => {
    if (!online || !selectedBranchId) return;
    if (!user) return;
    const pending = await listQueuedSales(selectedBranchId, user.uid);
    if (pending.length === 0) return;
    setBusy(true);
    let synchronized = 0;
    for (const sale of pending.filter((item) => item.status === "queued")) {
      try {
        await callAdministration<PosSalePayload, SaleResult>(
          "commitPosSale",
          sale.payload,
        );
        await removeQueuedSale(sale.id);
        synchronized += 1;
      } catch (cause) {
        const text = cause instanceof Error ? cause.message : "Synchronization failed.";
        const needsReview = /outdated price|stock|reconciliation|price/i.test(text);
        if (needsReview)
          await updateQueuedSale({
            ...sale,
            status: "needs_review",
            lastError: text,
          });
        else break;
      }
    }
    await refreshQueue();
    if (synchronized > 0) {
      setMessage(`${synchronized} offline sale${synchronized === 1 ? "" : "s"} synchronized.`);
      await loadWorkspace();
    }
    setBusy(false);
  }, [loadWorkspace, online, refreshQueue, selectedBranchId, user]);

  useEffect(() => {
    const synchronize = () => void syncQueue();
    window.addEventListener("online", synchronize);
    return () => window.removeEventListener("online", synchronize);
  }, [syncQueue]);

  const queuedQuantityByProduct = useMemo(() => {
    const result = new Map<string, number>();
    for (const sale of queued)
      for (const line of sale.payload.lines)
        result.set(
          line.productId,
          (result.get(line.productId) ?? 0) + line.quantity,
        );
    return result;
  }, [queued]);

  const visibleProducts = useMemo(
    () =>
      (workspace?.products ?? []).filter((product) =>
        `${product.name} ${product.sku}`.toLowerCase().includes(search.toLowerCase()),
      ),
    [search, workspace?.products],
  );

  function addProduct(productId: string) {
    const product = workspace?.products.find((item) => item.id === productId);
    if (!product) return;
    const alreadyQueued = queuedQuantityByProduct.get(product.id) ?? 0;
    const current = cart.find((line) => line.product.id === product.id)?.quantity ?? 0;
    if (current + alreadyQueued >= product.availableQuantity) {
      setError(`Only ${Math.max(0, product.availableQuantity - alreadyQueued)} ${product.unitOfMeasure} of ${product.name} remain for this device.`);
      return;
    }
    setError(null);
    setCart((lines) => {
      const found = lines.find((line) => line.product.id === product.id);
      return found
        ? lines.map((line) =>
            line.product.id === product.id
              ? { ...line, quantity: line.quantity + 1 }
              : line,
          )
        : [...lines, { product, quantity: 1 }];
    });
  }

  function changeQuantity(productId: string, delta: number) {
    setCart((lines) =>
      lines.flatMap((line) => {
        if (line.product.id !== productId) return [line];
        const quantity = line.quantity + delta;
        if (quantity <= 0) return [];
        const available =
          line.product.availableQuantity -
          (queuedQuantityByProduct.get(productId) ?? 0);
        return [{ ...line, quantity: Math.min(quantity, available) }];
      }),
    );
  }

  async function openShift() {
    if (!workspace || !online) return;
    setBusy(true);
    setError(null);
    try {
      const deviceId = deviceIdentity();
      await callAdministration("openPosShift", {
        branchId: workspace.branch.id,
        deviceId,
        deviceName: `${navigator.platform || "Browser"} POS`,
        openingCashMinor: nairaToKobo(Number(openingCash)),
        idempotencyKey: crypto.randomUUID(),
      });
      await loadWorkspace();
      setMessage("Shift opened. This device is ready to sell online or offline.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The shift could not be opened.");
    } finally {
      setBusy(false);
    }
  }

  async function closeShift() {
    if (!workspace?.openShift || !online) return;
    setBusy(true);
    setError(null);
    try {
      await syncQueue();
      const stillPending = await listQueuedSales(
        workspace.branch.id,
        user?.uid,
      );
      if (stillPending.length > 0)
        throw new Error("Synchronize or review every offline sale before closing this shift.");
      await callAdministration("closePosShift", {
        shiftId: workspace.openShift.id,
        closingCashMinor: nairaToKobo(Number(closingCash)),
        idempotencyKey: crypto.randomUUID(),
      });
      setClosingCash("");
      await loadWorkspace();
      setMessage("Shift closed and cash variance recorded.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The shift could not be closed.");
    } finally {
      setBusy(false);
    }
  }

  async function checkout() {
    if (!workspace?.openShift || cart.length === 0 || totals.grossAmountMinor <= 0)
      return;
    setBusy(true);
    setError(null);
    const idempotencyKey = crypto.randomUUID();
    const provisional = provisionalReceiptReference(workspace.branch.code);
    const payload: PosSalePayload = {
      branchId: workspace.branch.id,
      shiftId: workspace.openShift.id,
      deviceId: workspace.openShift.deviceId,
      recordedAt: new Date().toISOString(),
      offline: !online,
      provisionalReceiptReference: !online ? provisional : undefined,
      lines: cart.map(({ product, quantity }) => ({
        productId: product.id,
        quantity,
        ...(!online
          ? {
              priceVersion: product.priceVersion,
              unitPriceMinor: product.unitPriceMinor,
              vatRateBasisPoints: product.vatRateBasisPoints,
            }
          : {}),
      })),
      payments: [
        {
          method: paymentMethod,
          amountMinor: totals.grossAmountMinor,
          reference: paymentReference.trim() || undefined,
        },
      ],
      idempotencyKey,
    };
    try {
      if (online) {
        const result = await callAdministration<PosSalePayload, SaleResult>(
          "commitPosSale",
          payload,
        );
        setReceipt({
          reference: result.receiptNumber,
          totalMinor: totals.grossAmountMinor,
          queued: false,
        });
        await loadWorkspace();
      } else {
        if (!user) throw new Error("Your signed-in session is unavailable.");
        const queuedSale: QueuedPosSale = {
          id: idempotencyKey,
          userId: user.uid,
          branchId: workspace.branch.id,
          provisionalReceiptReference: provisional,
          payload,
          grossAmountMinor: totals.grossAmountMinor,
          createdAt: payload.recordedAt,
          status: "queued",
        };
        await queueOfflineSale(queuedSale);
        await refreshQueue();
        setReceipt({
          reference: provisional,
          totalMinor: totals.grossAmountMinor,
          queued: true,
        });
      }
      setCart([]);
      setPaymentReference("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The sale could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  async function saveBranchPrice() {
    const product = workspace?.products.find((item) => item.id === priceProductId);
    if (!workspace || !product) return;
    setBusy(true);
    setError(null);
    try {
      await callAdministration("saveBranchSalesPrice", {
        branchId: workspace.branch.id,
        productId: product.id,
        sellingPriceMinor: nairaToKobo(Number(branchPrice)),
        active: true,
        reason: priceReason.trim() || undefined,
        idempotencyKey: crypto.randomUUID(),
      });
      setPriceProductId(null);
      setPriceReason("");
      await loadWorkspace();
      setMessage(`Branch price updated for ${product.name}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The branch price could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  if (!canSell)
    return (
      <div className="rounded-xl border bg-white p-6">
        <h1 className="text-2xl font-semibold">Branch POS</h1>
        <p className="mt-2 text-[var(--muted)]">
          Your assigned roles do not include branch sales access.
        </p>
      </div>
    );

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-[var(--brand)]">Branch sales</p>
          <h1 className="text-3xl font-semibold">Point of sale</h1>
          <p className="text-[var(--muted)]">
            Sell from branch stock. VAT is shown separately and every confirmed sale posts inventory and accounts together.
          </p>
        </div>
        {!branchContextId && !assignedBranchId && (
          <label className="text-sm font-medium">
            Selling branch
            <select
              value={selectedBranchId}
              onChange={(event) => {
                setManualBranchId(event.target.value);
                setCart([]);
                setWorkspace(null);
              }}
              className="mt-1 block min-h-11 min-w-56 rounded-lg border bg-white px-3"
            >
              {branches.data
                .filter((branch) => branch.status === "active")
                .map((branch) => (
                  <option key={branch.id} value={branch.id}>{branch.name}</option>
                ))}
            </select>
          </label>
        )}
      </header>

      {!online && (
        <div className="flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <WifiOff className="mt-0.5 size-5 shrink-0" />
          <div><strong>Offline sales mode.</strong> Paid sales are saved on this device and synchronize after reconnecting. Prices and available quantities use the last trusted refresh.</div>
        </div>
      )}
      {error && <div role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</div>}
      {message && <div role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">{message}</div>}

      {queued.length > 0 && (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">Offline queue: {queued.length}</h2>
              <p className="text-sm text-amber-900">
                {queued.filter((sale) => sale.status === "needs_review").length} need manager review; the rest will retry safely.
              </p>
            </div>
            <Button variant="outline" disabled={!online || busy} onClick={() => void syncQueue()}>
              <RefreshCw className="mr-2 size-4" /> Synchronize now
            </Button>
          </div>
          {queued.some((sale) => sale.status === "needs_review") && (
            <ul className="mt-3 space-y-2 text-sm">
              {queued.filter((sale) => sale.status === "needs_review").map((sale) => (
                <li key={sale.id} className="rounded-lg bg-white p-3">
                  <strong>{sale.provisionalReceiptReference}</strong>: {sale.lastError}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {!workspace ? (
        <div className="grid min-h-64 place-items-center rounded-xl border bg-white p-6 text-center">
          <div>
            <RefreshCw className={`mx-auto mb-3 size-7 ${busy ? "animate-spin" : ""}`} />
            <p>{busy ? "Loading branch POS…" : "Choose an active selling branch."}</p>
          </div>
        </div>
      ) : !workspace.openShift ? (
        <section className="mx-auto max-w-xl rounded-2xl border bg-white p-6 shadow-sm">
          <Banknote className="mb-4 size-9 text-[var(--brand)]" />
          <h2 className="text-2xl font-semibold">Open the sales shift</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Count the cash physically in this till before the first sale. This opening figure is used only for cash reconciliation.
          </p>
          <label className="mt-5 block text-sm font-medium">
            Opening cash (₦)
            <input type="number" min="0" step="0.01" inputMode="decimal" value={openingCash} onChange={(event) => setOpeningCash(event.target.value)} className="mt-1 w-full rounded-lg border p-3 text-lg" />
          </label>
          <Button className="mt-5 w-full" disabled={!online || busy} onClick={() => void openShift()}>
            Open shift and start selling
          </Button>
          {!online && <p className="mt-2 text-center text-xs text-amber-800">A new shift must be opened online. An already-open cached shift continues offline.</p>}
        </section>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <section className="space-y-4">
            <div className="rounded-xl border bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{workspace.branch.name}</h2>
                  <p className="text-sm text-[var(--muted)]">Stock source: {workspace.location.name}</p>
                </div>
                <Button variant="outline" disabled={!online || busy} onClick={() => void loadWorkspace()}>
                  <RefreshCw className="mr-2 size-4" /> Refresh stock &amp; prices
                </Button>
              </div>
              <label className="relative mt-4 block">
                <Search className="absolute left-3 top-3.5 size-4 text-slate-400" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search product name or SKU" className="w-full rounded-lg border py-3 pl-10 pr-3" />
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {visibleProducts.map((product) => {
                const available = Math.max(0, product.availableQuantity - (queuedQuantityByProduct.get(product.id) ?? 0));
                return (
                  <article key={product.id} className="min-h-40 rounded-xl border bg-white p-4 text-left transition hover:border-emerald-400 hover:shadow-sm">
                    <span className="block font-semibold">{product.name}</span>
                    <span className="mt-1 block font-mono text-xs text-[var(--muted)]">{product.sku}</span>
                    <span className="mt-4 block text-xl font-semibold">{formatNaira(product.unitPriceMinor)}</span>
                    <span className="block text-xs text-[var(--muted)]">before VAT · {product.priceSource} price</span>
                    <span className="mt-3 block text-sm">{available} {product.unitOfMeasure} available</span>
                    <div className="mt-3 flex gap-2">
                      <Button className="flex-1" disabled={available <= 0} onClick={() => addProduct(product.id)}>Add</Button>
                      {canManageBranchPrice && online && (
                        <Button
                          variant="outline"
                          onClick={() => {
                            setPriceProductId(product.id);
                            setBranchPrice(String(product.unitPriceMinor / 100));
                            setPriceReason("");
                          }}
                        >
                          Price
                        </Button>
                      )}
                    </div>
                  </article>
                );
              })}
              {visibleProducts.length === 0 && (
                <div className="col-span-full rounded-xl border bg-white p-8 text-center text-[var(--muted)]">
                  No sale-ready products match. Products require an active central selling price and branch stock.
                </div>
              )}
            </div>
          </section>

          <aside className="h-fit rounded-2xl border bg-white p-5 lg:sticky lg:top-20">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-xl font-semibold"><ShoppingCart className="size-5" /> Current sale</h2>
              <span className="text-sm text-[var(--muted)]">{totals.totalQuantity} items</span>
            </div>
            <div className="my-4 max-h-72 space-y-3 overflow-y-auto">
              {cart.length === 0 ? (
                <p className="rounded-lg bg-slate-50 p-5 text-center text-sm text-[var(--muted)]">Tap a product to add it.</p>
              ) : cart.map((line) => (
                <div key={line.product.id} className="rounded-lg border p-3">
                  <div className="flex justify-between gap-3"><strong className="text-sm">{line.product.name}</strong><span className="text-sm">{formatNaira(line.quantity * line.product.unitPriceMinor)}</span></div>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-xs text-[var(--muted)]">{formatNaira(line.product.unitPriceMinor)} each</span>
                    <div className="flex items-center gap-2">
                      <Button size="icon" variant="outline" onClick={() => changeQuantity(line.product.id, -1)} aria-label={`Remove one ${line.product.name}`}><Minus className="size-4" /></Button>
                      <span className="min-w-6 text-center font-semibold">{line.quantity}</span>
                      <Button size="icon" variant="outline" onClick={() => changeQuantity(line.product.id, 1)} aria-label={`Add one ${line.product.name}`}><Plus className="size-4" /></Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <dl className="space-y-2 border-y py-4 text-sm">
              <div className="flex justify-between"><dt>Products</dt><dd>{formatNaira(totals.netAmountMinor)}</dd></div>
              <div className="flex justify-between"><dt>VAT</dt><dd>{formatNaira(totals.vatAmountMinor)}</dd></div>
              <div className="flex justify-between text-lg font-semibold"><dt>Total</dt><dd>{formatNaira(totals.grossAmountMinor)}</dd></div>
            </dl>
            <label className="mt-4 block text-sm font-medium">Payment method
              <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PosPaymentMethod)} className="mt-1 w-full rounded-lg border p-3">
                <option value="cash">Cash</option><option value="card">Card / POS terminal</option><option value="bank_transfer">Bank transfer</option>
              </select>
            </label>
            {paymentMethod !== "cash" && <label className="mt-3 block text-sm font-medium">Payment reference (optional)<input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} className="mt-1 w-full rounded-lg border p-3" placeholder="Terminal or transfer reference" /></label>}
            <Button className="mt-5 w-full" disabled={busy || cart.length === 0} onClick={() => void checkout()}>
              {online ? "Complete sale" : "Save offline sale"} · {formatNaira(totals.grossAmountMinor)}
            </Button>
            <p className="mt-2 text-center text-xs text-[var(--muted)]">{online ? "Stock, receipt, payment, VAT and accounts post together." : "A provisional receipt is issued now; posting occurs after sync."}</p>
            <details className="mt-5 border-t pt-4">
              <summary className="cursor-pointer text-sm font-semibold">Close shift</summary>
              <label className="mt-3 block text-sm">Counted closing cash (₦)<input type="number" min="0" step="0.01" value={closingCash} onChange={(event) => setClosingCash(event.target.value)} className="mt-1 w-full rounded-lg border p-2.5" /></label>
              <Button className="mt-3 w-full" variant="outline" disabled={!online || !closingCash || busy} onClick={() => void closeShift()}>Close and reconcile shift</Button>
            </details>
          </aside>
        </div>
      )}

      {receipt && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Sale receipt">
          <section className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl">
            {receipt.queued ? <CircleAlert className="mx-auto size-12 text-amber-600" /> : <CheckCircle2 className="mx-auto size-12 text-emerald-600" />}
            <h2 className="mt-3 text-2xl font-semibold">{receipt.queued ? "Sale saved offline" : "Sale completed"}</h2>
            <p className="mt-2 font-mono text-sm">{receipt.reference}</p>
            <p className="mt-4 text-3xl font-semibold">{formatNaira(receipt.totalMinor)}</p>
            <p className="mt-3 text-sm text-[var(--muted)]">{receipt.queued ? "This provisional receipt will be linked to the official receipt after synchronization." : "Inventory, VAT, payment and accounting records were posted."}</p>
            <div className="mt-5 flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => window.print()}><Printer className="mr-2 size-4" /> Print</Button>
              <Button className="flex-1" onClick={() => setReceipt(null)}>New sale</Button>
            </div>
          </section>
        </div>
      )}

      {priceProductId && workspace && (() => {
        const product = workspace.products.find((item) => item.id === priceProductId);
        if (!product) return null;
        const enteredMinor = Number.isFinite(Number(branchPrice))
          ? Math.round(Number(branchPrice) * 100)
          : 0;
        const belowBase = enteredMinor < product.basePriceMinor;
        return (
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Branch selling price">
            <section className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
              <h2 className="text-xl font-semibold">Set branch price</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">{product.name} · Central base {formatNaira(product.basePriceMinor)}</p>
              <label className="mt-5 block text-sm font-medium">Branch price before VAT (₦)<input type="number" min="0.01" step="0.01" inputMode="decimal" value={branchPrice} onChange={(event) => setBranchPrice(event.target.value)} className="mt-1 w-full rounded-lg border p-3 text-lg" /></label>
              {belowBase && (
                <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
                  This is below the central base. Only a system administrator may approve it, and a reason is mandatory.
                </div>
              )}
              <label className="mt-3 block text-sm font-medium">Approval reason {belowBase ? "(required)" : "(optional)"}<textarea value={priceReason} onChange={(event) => setPriceReason(event.target.value)} className="mt-1 w-full rounded-lg border p-3" /></label>
              <div className="mt-5 flex justify-end gap-3"><Button variant="secondary" onClick={() => setPriceProductId(null)}>Cancel</Button><Button disabled={busy || !branchPrice || (belowBase && priceReason.trim().length < 3)} onClick={() => void saveBranchPrice()}>Save branch price</Button></div>
            </section>
          </div>
        );
      })()}
    </div>
  );
}

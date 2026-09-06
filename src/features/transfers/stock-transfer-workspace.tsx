"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  Boxes,
  CheckCircle2,
  CircleHelp,
  PackageCheck,
  Plus,
  RefreshCw,
  ShieldCheck,
  Store,
  Warehouse,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import { useAuth } from "@/features/auth/auth-context";
import { useConnectivity } from "@/lib/connectivity";
import {
  pendingStock,
  stockTransferStatusLabels,
  type StockTransfer,
} from "../../../functions/src/transfers/simple-model";
import { TransferList } from "./transfer-list";
import { downloadCsv } from "@/features/inventory/format";
import { hasPermission } from "@/lib/permissions/roles";
import { stockTransferExportRows } from "./stock-transfer-export";
import type { BranchRequest, BranchRequestItem } from "@/types/domain";

const api = <T,>(input: object) =>
  callAdministration<object, T>("stockTransfers", input);
const field = "mt-1 min-h-12 w-full rounded-xl border bg-white px-3 py-2";
const panel = "rounded-2xl border bg-white p-5 sm:p-6";
interface Location {
  id: string;
  name: string;
  stockArea: string;
  type: string;
  branchId: string | null;
  warehouseId: string | null;
  assigned: boolean;
}
interface Stock {
  id: string;
  productId: string;
  name: string;
  sku: string;
  trackingType: string;
  lotId: string | null;
  lotNumber?: string | null;
  available: number;
  serials: { id: string; name: string }[];
}
type Options = { locations: Location[]; canApprove: boolean };
type Detail = {
  transfer: StockTransfer;
  events: { id: string; action: string; note?: string; createdAt: string }[];
  canApprove: boolean;
  canReceive: boolean;
};
function errorText(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Unable to load this screen. Please try again.";
}

export function SimpleTransferSteps() {
  return (
    <ol aria-label="How to move stock" className="grid gap-3 sm:grid-cols-3">
      {[
        [
          Boxes,
          "1. Request stock",
          "Choose where the stock comes from and where it is needed.",
        ],
        [
          ShieldCheck,
          "2. Administrator approves",
          "Approved stock is held automatically for this transfer.",
        ],
        [
          PackageCheck,
          "3. Confirm arrival",
          "The receiving manager counts the goods. Stock updates automatically.",
        ],
      ].map(([Icon, title, detail]) => {
        const StepIcon = Icon as typeof Boxes;
        return (
          <li
            key={String(title)}
            className="grid grid-cols-[1.5rem_1fr] items-center gap-x-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 sm:block sm:p-4"
          >
            <StepIcon className="size-6 text-emerald-800 sm:mb-3" />
            <h3 className="font-semibold">{String(title)}</h3>
            <p className="sr-only mt-2 text-sm leading-6 text-[var(--muted)] sm:not-sr-only">
              {String(detail)}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
function Route({ transfer }: { transfer: StockTransfer }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <span className="flex items-center gap-2">
        {transfer.sourceBranchId ? (
          <Store className="size-5" />
        ) : (
          <Warehouse className="size-5" />
        )}{" "}
        {transfer.sourceName}
      </span>
      <ArrowRight className="size-5 text-emerald-700" />
      <span className="flex items-center gap-2">
        <Store className="size-5" />
        {transfer.destinationName}
      </span>
    </div>
  );
}
function Notice({ text }: { text: string }) {
  return (
    <p
      role="alert"
      className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950"
    >
      {text}
    </p>
  );
}

export function StockTransferList() {
  const { profile } = useAuth();
  const roles = profile?.roleIds?.length ? profile.roleIds : [profile?.roleId];
  if (!profile) return <p>Loading your access…</p>;
  if (
    !roles.some((r) =>
      [
        "system_administrator",
        "operations_administrator",
        "branch_manager",
        "warehouse_manager",
        "finance_officer",
        "auditor",
      ].includes(r ?? ""),
    )
  )
    return <TransferList />;
  return <ManagedStockTransferList />;
}

function ManagedStockTransferList() {
  const { profile, operatingContext } = useAuth();
  const roles = profile?.roleIds?.length ? profile.roleIds : [profile?.roleId];
  const canCreate = roles.some((r) =>
    [
      "system_administrator",
      "operations_administrator",
      "branch_manager",
      "warehouse_manager",
    ].includes(r ?? ""),
  );
  const [rows, setRows] = useState<StockTransfer[]>([]),
    [options, setOptions] = useState<Options | null>(null);
  const [filter, setFilter] = useState(canCreate ? "attention" : "all"),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const load = useCallback((isActive: () => boolean = () => true) => {
    const fetchRows = async () => {
      const result: StockTransfer[] = [];
      let cursor: string | undefined;
      do {
        const page = await api<{
          rows: StockTransfer[];
          nextCursor: string | null;
        }>({ action: "list", cursor });
        result.push(...page.rows);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return { result, opts: await api<Options>({ action: "options" }) };
    };
    return fetchRows()
      .then(({ result, opts }) => {
        if (isActive()) {
          setRows(result);
          setOptions(opts);
          setError("");
        }
      })
      .catch((e) => {
        if (isActive()) setError(errorText(e));
      })
      .finally(() => {
        if (isActive()) setLoading(false);
      });
  }, []);
  useEffect(() => {
    let active = true;
    void load(() => active);
    return () => {
      active = false;
    };
  }, [load, profile, operatingContext]);
  const mine = (t: StockTransfer) =>
    t.status === "problem"
      ? options?.canApprove
      : t.status === "requested"
        ? options?.canApprove
        : ["awaiting_receipt", "partially_received"].includes(t.status) &&
          (options?.canApprove ||
            options?.locations.some(
              (l) => l.assigned && l.id === t.destinationLocationId,
            ));
  const scoped = rows.filter(
    (t) =>
      !operatingContext ||
      (operatingContext.type === "warehouse"
        ? t.sourceWarehouseId === operatingContext.id
        : t.sourceBranchId === operatingContext.id ||
          t.destinationBranchId === operatingContext.id),
  );
  const shown = scoped
    .filter(
      (t) =>
        filter === "all" ||
        (filter === "attention" && mine(t)) ||
        (filter === "waiting" &&
          !["completed", "cancelled"].includes(t.status)) ||
        (filter === "completed" &&
          ["completed", "cancelled"].includes(t.status)) ||
        (filter === "problems" && t.status === "problem"),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <div className="page-stack">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Move stock</h1>
          <p className="mt-2 text-[var(--muted)]">
            Between your warehouse and stores, or directly from one branch to
            another.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {profile &&
            hasPermission(profile, "reports.transfers.export") &&
            shown.length > 0 && (
              <Button
                variant="secondary"
                onClick={() =>
                  downloadCsv(
                    "stock-transfer-register.csv",
                    stockTransferExportRows(shown),
                  )
                }
              >
                Download this view
              </Button>
            )}
          <Button
            variant="secondary"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw className="mr-2 size-4" />
            Refresh
          </Button>
          {canCreate && (
            <Link
              href="/transfers/create/direct"
              className="inline-flex min-h-12 items-center rounded-xl bg-[var(--brand)] px-4 font-semibold text-white"
            >
              <Plus className="mr-2 size-5" />
              Request stock
            </Link>
          )}
        </div>
      </header>
      <SimpleTransferSteps />
      <nav aria-label="Transfer views" className="flex flex-wrap gap-2">
        {(
          [
            ["attention", "Needs my attention"],
            ["waiting", "Waiting"],
            ["completed", "Completed"],
            ["problems", "Problems"],
            ["all", "All"],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            variant={filter === value ? "primary" : "secondary"}
            onClick={() => setFilter(value)}
          >
            {label}
          </Button>
        ))}
      </nav>
      {error && <Notice text={error} />}
      {loading ? (
        <p role="status">Loading transfers…</p>
      ) : !shown.length ? (
        <section className={`${panel} text-center`}>
          <CheckCircle2 className="mx-auto mb-3 size-10 text-emerald-700" />
          <h2 className="font-semibold">
            {filter === "attention"
              ? "Nothing needs your attention here"
              : "No transfers in this view"}
          </h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Check Waiting to see requests being handled by someone else.
          </p>
        </section>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {shown.map((t) => (
            <Link
              key={t.id}
              href={`/transfers/simple/${t.id}`}
              className={`${panel} block transition-colors hover:border-emerald-600`}
            >
              <div className="mb-4 flex flex-wrap justify-between gap-2">
                <strong>{t.number}</strong>
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold">
                  {stockTransferStatusLabels[t.status]}
                </span>
              </div>
              <Route transfer={t} />
              <p className="mt-4 text-sm">
                {t.items
                  .map((l) => `${l.productName} × ${l.requested}`)
                  .join(" · ")}
              </p>
              <p className="mt-3 font-medium text-emerald-800">
                {t.status === "requested"
                  ? "Waiting for administrator approval"
                  : ["completed", "cancelled"].includes(t.status)
                    ? "View completed record"
                    : t.status === "problem"
                      ? "Administrator: review reported problem"
                      : `${t.destinationName}: confirm what arrived`}{" "}
                →
              </p>
            </Link>
          ))}
        </div>
      )}
      <footer className="flex flex-wrap gap-5 text-sm">
        <Link className="underline" href="/guide#transfers">
          <CircleHelp className="mr-1 inline size-4" />
          How to move stock
        </Link>
        <Link className="underline" href="/transfers/legacy">
          Earlier transfers and optional detailed logistics
        </Link>
        <Link className="underline" href="/transfers/create/from-request">
          Use an existing approved branch request
        </Link>
      </footer>
    </div>
  );
}

export function StockTransferForm({
  fromRequest = false,
}: {
  fromRequest?: boolean;
}) {
  const router = useRouter();
  const { operatingContext } = useAuth();
  const { online } = useConnectivity();
  const [options, setOptions] = useState<Options | null>(null),
    [stock, setStock] = useState<Stock[]>([]);
  const [source, setSource] = useState(""),
    [destination, setDestination] = useState(""),
    [note, setNote] = useState("");
  const [lines, setLines] = useState([
    { stockId: "", quantity: 1, sourceRequestItemId: "" },
  ]);
  const [requestId, setRequestId] = useState(""),
    [requests, setRequests] = useState<BranchRequest[]>([]),
    [requestItems, setRequestItems] = useState<BranchRequestItem[]>([]);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loadedStockSource, setLoadedStockSource] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  useEffect(() => {
    let active = true;
    void api<Options>({ action: "options" })
      .then((o) => {
        if (!active) return;
        setOptions(o);
        const own = o.locations.filter(
          (l) =>
            l.assigned &&
            (!operatingContext ||
              (operatingContext.type === "branch"
                ? l.branchId === operatingContext.id
                : l.warehouseId === operatingContext.id)),
        );
        if (own.length === 1) {
          if (own[0]!.type === "branch") setDestination(own[0]!.id);
          else setSource(own[0]!.id);
        }
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      });
    return () => {
      active = false;
    };
  }, [operatingContext]);
  useEffect(() => {
    let active = true;
    if (fromRequest)
      void callAdministration<object, { rows: BranchRequest[] }>(
        "listBranchRequests",
        { limit: 100 },
      )
        .then((r) => {
          if (active)
            setRequests(
              r.rows.filter((v) =>
                [
                  "approved",
                  "partially_approved",
                  "partially_fulfilled",
                ].includes(v.status),
              ),
            );
        })
        .catch((e) => {
          if (active) setError(errorText(e));
        });
    return () => {
      active = false;
    };
  }, [fromRequest]);
  useEffect(() => {
    if (!source) return;
    let active = true;
    void api<{ stock: Stock[] }>({ action: "stock", locationId: source })
      .then((r) => {
        if (active) setStock(r.stock);
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      })
      .finally(() => {
        if (active) setLoadedStockSource(source);
      });
    return () => {
      active = false;
    };
  }, [source]);
  async function selectRequest(value: string) {
    setRequestId(value);
    setRequestItems([]);
    if (!value) return;
    try {
      const r = await callAdministration<
        object,
        { request: BranchRequest; items: BranchRequestItem[] }
      >("getBranchRequest", { requestId: value, limit: 100 });
      setRequestItems(r.items.filter((i) => i.outstandingQuantity > 0));
      const locations =
        options?.locations.filter((l) => l.branchId === r.request.branchId) ??
        [];
      setDestination(locations.length === 1 ? locations[0]!.id : "");
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!online || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ transferId: string }>({
        action: "create",
        sourceLocationId: source,
        destinationLocationId: destination,
        sourceRequestId: fromRequest ? requestId : undefined,
        note,
        items: lines.map((l) => {
          const s = stock.find((v) => v.id === l.stockId);
          if (!s) throw new Error("Choose a product from the selected source.");
          return {
            productId: s.productId,
            quantity: l.quantity,
            lotId: s.lotId ?? undefined,
            sourceRequestItemId: l.sourceRequestItemId || undefined,
          };
        }),
        idempotencyKey: key,
      });
      router.push(`/transfers/simple/${result.transferId}`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const stockLoading = source !== loadedStockSource;
  const sourceOption = options?.locations.find((l) => l.id === source);
  return (
    <form
      onSubmit={submit}
      onChange={() => setKey(crypto.randomUUID())}
      className="page-stack mx-auto max-w-4xl"
    >
      <Link href="/transfers" className="text-sm underline">
        ← All transfers
      </Link>
      <header>
        <h1 className="text-3xl font-semibold">
          {fromRequest ? "Fulfil an approved request" : "Request stock"}
        </h1>
        <p className="mt-2 text-[var(--muted)]">
          Choose the goods you need. The administrator will review the request.
        </p>
      </header>
      <SimpleTransferSteps />
      {error && <Notice text={error} />}
      {!online && (
        <Notice text="Connect to the internet to submit. Your current form stays on this screen." />
      )}
      <section className={`${panel} grid gap-5 sm:grid-cols-2`}>
        {fromRequest && (
          <label className="sm:col-span-2">
            Approved branch request
            <select
              required
              value={requestId}
              onChange={(e) => void selectRequest(e.target.value)}
              className={field}
            >
              <option value="">Choose request</option>
              {requests.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.requestNumber} · {r.totalOutstandingQuantity} still needed
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          From
          <select
            required
            className={field}
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              const nextSource = options?.locations.find(
                (l) => l.id === e.target.value,
              );
              const currentDestination = options?.locations.find(
                (l) => l.id === destination,
              );
              if (
                nextSource?.id === destination ||
                (nextSource?.branchId &&
                  nextSource.branchId === currentDestination?.branchId)
              )
                setDestination("");
              setStock([]);
              setLines([{ stockId: "", quantity: 1, sourceRequestItemId: "" }]);
            }}
          >
            <option value="">Where is the stock?</option>
            {options?.locations
              .filter((l) => l.id !== destination)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.type === "warehouse" ? "Warehouse" : "Branch"}: {l.name}
                  {options.locations.filter((x) => x.name === l.name).length > 1
                    ? ` — ${l.stockArea}`
                    : ""}
                </option>
              ))}
          </select>
        </label>
        <label>
          To
          <select
            required
            className={field}
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
          >
            <option value="">Which branch needs it?</option>
            {options?.locations
              .filter(
                (l) =>
                  l.type === "branch" &&
                  l.id !== source &&
                  (!sourceOption?.branchId ||
                    l.branchId !== sourceOption.branchId) &&
                  (sourceOption?.assigned || l.assigned) &&
                  (!fromRequest ||
                    !requestId ||
                    l.branchId ===
                      requests.find((r) => r.id === requestId)?.branchId),
              )
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                  {options.locations.filter((x) => x.name === l.name).length > 1
                    ? ` — ${l.stockArea}`
                    : ""}
                </option>
              ))}
          </select>
        </label>
      </section>
      <section className={`${panel} space-y-4`}>
        <h2 className="text-xl font-semibold">What do you need?</h2>
        {stockLoading && <p role="status">Checking available stock…</p>}
        {source && !stockLoading && !stock.length && (
          <Notice text="There is no available stock at this source. Choose another source, or ask the administrator to record the existing stock." />
        )}
        {lines.map((line, index) => (
          <div
            key={index}
            className="grid gap-3 rounded-xl border p-3 sm:grid-cols-[1fr_8rem_auto]"
          >
            <label>
              Product
              <select
                required
                className={field}
                value={line.stockId}
                onChange={(e) => {
                  const selected = stock.find((s) => s.id === e.target.value);
                  const requestItem = requestItems.find(
                    (i) => i.productId === selected?.productId,
                  );
                  setLines((v) =>
                    v.map((l, i) =>
                      i === index
                        ? {
                            ...l,
                            stockId: e.target.value,
                            sourceRequestItemId: requestItem?.id ?? "",
                          }
                        : l,
                    ),
                  );
                }}
              >
                <option value="">Choose product</option>
                {stock
                  .filter(
                    (s) =>
                      !fromRequest ||
                      requestItems.some((i) => i.productId === s.productId),
                  )
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · {s.available} available
                      {s.lotId ? ` · Lot ${s.lotNumber ?? s.lotId}` : ""}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Quantity
              <input
                required
                type="number"
                min={1}
                max={
                  stock.find((s) => s.id === line.stockId)?.available ??
                  1_000_000
                }
                className={field}
                value={line.quantity || ""}
                onChange={(e) =>
                  setLines((v) =>
                    v.map((l, i) =>
                      i === index
                        ? { ...l, quantity: Number(e.target.value) }
                        : l,
                    ),
                  )
                }
              />
            </label>
            {lines.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setKey(crypto.randomUUID());
                  setLines((v) => v.filter((_, i) => i !== index));
                }}
              >
                Remove
              </Button>
            )}
          </div>
        ))}
        <Button
          type="button"
          variant="secondary"
          disabled={lines.length >= 20}
          onClick={() => {
            setKey(crypto.randomUUID());
            setLines((v) => [
              ...v,
              { stockId: "", quantity: 1, sourceRequestItemId: "" },
            ]);
          }}
        >
          <Plus className="mr-2 size-4" />
          Add another product
        </Button>
      </section>
      <label className={panel}>
        Note (optional)
        <textarea
          className={field}
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
          placeholder="For example: needed for a customer order tomorrow"
        />
      </label>
      <Button
        disabled={busy || !online || stockLoading || !options}
        type="submit"
      >
        {busy ? "Submitting…" : "Submit for approval"}
      </Button>
    </form>
  );
}

export function StockTransferDetail({ transferId }: { transferId: string }) {
  const { profile } = useAuth();
  const { online } = useConnectivity();
  const [detail, setDetail] = useState<Detail | null>(null),
    [stock, setStock] = useState<Stock[]>([]);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [note, setNote] = useState(""),
    [partial, setPartial] = useState(false);
  const [quantities, setQuantities] = useState<
    Record<
      string,
      {
        approved: number;
        received: number;
        damaged: number;
        serials: string[];
        damagedSerials: string[];
      }
    >
  >({});
  const [disposition, setDisposition] = useState("still_expected"),
    [key, setKey] = useState(() => crypto.randomUUID());
  const load = useCallback(
    (isActive: () => boolean = () => true) =>
      api<Detail>({ action: "get", transferId })
        .then(async (result) => {
          if (!isActive()) return;
          setError("");
          setDetail(result);
          setQuantities(
            Object.fromEntries(
              result.transfer.items.map((l) => [
                l.id,
                {
                  approved: l.requested,
                  received: Math.max(0, pendingStock(l)),
                  damaged: 0,
                  serials: l.serialItemIds,
                  damagedSerials: [],
                },
              ]),
            ),
          );
          setKey(crypto.randomUUID());
          if (result.canApprove && result.transfer.status === "requested") {
            const response = await api<{ stock: Stock[] }>({
              action: "stock",
              locationId: result.transfer.sourceLocationId,
            });
            if (isActive()) setStock(response.stock);
          }
        })
        .catch((e) => {
          if (isActive()) setError(errorText(e));
        }),
    [transferId],
  );
  useEffect(() => {
    let active = true;
    void load(() => active);
    return () => {
      active = false;
    };
  }, [load, profile]);
  const transfer = detail?.transfer;
  async function act(action: string, extras: object = {}) {
    if (!transfer || busy || !online) return;
    setBusy(true);
    setError("");
    try {
      await api({
        action,
        transferId,
        version: transfer.version,
        idempotencyKey: key,
        ...extras,
      });
      setNote("");
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  function update(id: string, values: Partial<(typeof quantities)[string]>) {
    setQuantities((v) => ({ ...v, [id]: { ...v[id]!, ...values } }));
    setKey(crypto.randomUUID());
  }
  if (!detail || !transfer)
    return (
      <div className="page-stack">
        <Link href="/transfers">← All transfers</Link>
        {error ? (
          <Notice text={error} />
        ) : (
          <p role="status">Loading transfer…</p>
        )}
        <Button onClick={() => void load()}>Try again</Button>
      </div>
    );
  const approval = transfer.status === "requested" && detail.canApprove;
  const receipt =
    ["awaiting_receipt", "partially_received", "problem"].includes(
      transfer.status,
    ) &&
    detail.canReceive &&
    transfer.items.some((l) => pendingStock(l) > 0);
  const finished = ["completed", "cancelled"].includes(transfer.status);
  return (
    <div className="page-stack mx-auto max-w-5xl">
      <div className="flex items-center justify-between">
        <Link className="underline" href="/transfers">
          ← All transfers
        </Link>
        <Button variant="secondary" disabled={busy} onClick={() => void load()}>
          <RefreshCw className="mr-2 size-4" />
          Refresh
        </Button>
      </div>
      <header className="rounded-2xl bg-emerald-900 p-6 text-white">
        <p className="mb-2 text-sm text-emerald-100">
          {transfer.number} · {stockTransferStatusLabels[transfer.status]}
        </p>
        <Route transfer={transfer} />
        <h1 className="mt-5 text-2xl font-semibold">
          {finished
            ? "Transfer finished"
            : approval
              ? "Review and approve the stock"
              : receipt
                ? "Have the goods arrived?"
                : "Waiting for the next person"}
        </h1>
        <p className="mt-2 text-emerald-100">
          {finished
            ? "Your stock records and receipt history are saved below."
            : transfer.status === "requested"
              ? "An administrator approves the quantities. Stock is then held automatically."
              : `The manager at ${transfer.destinationName} confirms only the goods that have actually arrived.`}
        </p>
      </header>
      {error && <Notice text={error} />}
      {!online && (
        <Notice text="Reconnect before approving or confirming stock. This prevents duplicate or conflicting stock movements." />
      )}
      {transfer.problemNote && (
        <Notice text={`Reported problem: ${transfer.problemNote}`} />
      )}
      {transfer.note && <p className={panel}>Request note: {transfer.note}</p>}
      {receipt && (
        <div className="flex flex-wrap gap-3">
          <Button
            variant={!partial ? "primary" : "secondary"}
            onClick={() => setPartial(false)}
          >
            Everything arrived in good condition
          </Button>
          <Button
            variant={partial ? "primary" : "secondary"}
            onClick={() => setPartial(true)}
          >
            Some items are missing or damaged
          </Button>
        </div>
      )}
      <section className={`${panel} space-y-4`}>
        <h2 className="text-xl font-semibold">Products</h2>
        {transfer.items.map((line) => {
          const q = quantities[line.id]!;
          const available = stock.find(
            (s) =>
              s.productId === line.productId &&
              (s.lotId ?? undefined) === line.lotId,
          );
          return (
            <div key={line.id} className="rounded-xl border p-4">
              <h3 className="font-semibold">{line.productName}</h3>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Requested {line.requested} · Approved {line.approved} · Received{" "}
                {line.received} · Damaged {line.damaged}
                {line.cancelled ? ` · Cancelled ${line.cancelled}` : ""}
                {line.writtenOff ? ` · Lost ${line.writtenOff}` : ""}
                {transfer.status !== "requested"
                  ? ` · Still expected ${Math.max(0, pendingStock(line))}`
                  : ""}
              </p>
              {approval && (
                <label className="mt-3 block">
                  Approve quantity{" "}
                  <span className="text-sm text-[var(--muted)]">
                    ({available?.available ?? 0} currently available)
                  </span>
                  <input
                    type="number"
                    className={field}
                    min={0}
                    max={Math.min(line.requested, available?.available ?? 0)}
                    value={q.approved}
                    onChange={(e) =>
                      update(line.id, { approved: Number(e.target.value) })
                    }
                  />
                </label>
              )}
              {receipt && partial && (
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <label>
                    Arrived in good condition
                    <input
                      className={field}
                      type="number"
                      min={0}
                      max={pendingStock(line)}
                      value={q.received}
                      onChange={(e) =>
                        update(line.id, { received: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label>
                    Arrived damaged
                    <input
                      className={field}
                      type="number"
                      min={0}
                      max={pendingStock(line)}
                      value={q.damaged}
                      onChange={(e) =>
                        update(line.id, { damaged: Number(e.target.value) })
                      }
                    />
                  </label>
                  <p className="col-span-2 text-sm">
                    Still expected after this receipt:{" "}
                    {Math.max(0, pendingStock(line) - q.received - q.damaged)}
                  </p>
                </div>
              )}
              {line.trackingType === "serial" &&
                (approval || (receipt && partial)) && (
                  <fieldset className="mt-4">
                    <legend className="font-medium">
                      {approval
                        ? "Choose the serial numbers to reserve"
                        : "Match each serial to what arrived"}
                    </legend>
                    {(approval
                      ? (available?.serials ?? [])
                      : line.serialItemIds.map((id) => ({
                          id,
                          name: line.serialNumbers?.[id] ?? id,
                        }))
                    ).map((s) => (
                      <label
                        key={s.id}
                        className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-2 text-sm"
                      >
                        <span className="break-all">{s.name}</span>
                        <select
                          className="min-h-11 rounded-lg border px-2"
                          value={
                            q.damagedSerials.includes(s.id)
                              ? "damaged"
                              : q.serials.includes(s.id)
                                ? "good"
                                : "pending"
                          }
                          onChange={(e) => {
                            const good = q.serials.filter((id) => id !== s.id),
                              damaged = q.damagedSerials.filter(
                                (id) => id !== s.id,
                              );
                            if (e.target.value === "good") good.push(s.id);
                            if (e.target.value === "damaged")
                              damaged.push(s.id);
                            update(line.id, {
                              serials: good,
                              damagedSerials: damaged,
                              ...(approval
                                ? { approved: good.length }
                                : {
                                    received: good.length,
                                    damaged: damaged.length,
                                  }),
                            });
                          }}
                        >
                          <option value="pending">
                            {approval ? "Do not reserve" : "Not arrived"}
                          </option>
                          <option value="good">
                            {approval ? "Reserve" : "Arrived in good condition"}
                          </option>
                          {!approval && (
                            <option value="damaged">Arrived damaged</option>
                          )}
                        </select>
                      </label>
                    ))}
                  </fieldset>
                )}
            </div>
          );
        })}
      </section>
      {(approval || receipt) && (
        <section className={`${panel} space-y-4`}>
          {receipt && partial && (
            <label className="block">
              Explain any problem
              <textarea
                className={field}
                maxLength={1000}
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                  setKey(crypto.randomUUID());
                }}
                placeholder="For example: two panels have not arrived yet"
              />
            </label>
          )}
          <p className="text-sm text-[var(--muted)]">
            {approval
              ? "Approved goods become unavailable for other sales or transfers. This does not confirm delivery."
              : "Confirm only after counting the goods. Good stock becomes available for sale; damaged stock is kept separately."}
          </p>
          <Button
            disabled={busy || !online}
            onClick={() =>
              void (approval
                ? act("approve", {
                    lines: transfer.items.map((l) => ({
                      id: l.id,
                      quantity: quantities[l.id]!.approved,
                      serialItemIds: quantities[l.id]!.serials,
                    })),
                  })
                : act("receive", {
                    note: partial ? note : "",
                    lines: transfer.items.map((l) => ({
                      id: l.id,
                      received: partial
                        ? quantities[l.id]!.received
                        : pendingStock(l),
                      damaged: partial ? quantities[l.id]!.damaged : 0,
                      serialItemIds: partial
                        ? quantities[l.id]!.serials
                        : l.serialItemIds,
                      damagedSerialItemIds: partial
                        ? quantities[l.id]!.damagedSerials
                        : [],
                    })),
                  }))
            }
          >
            {busy
              ? "Saving…"
              : approval
                ? "Approve and hold stock"
                : "Confirm goods received"}
          </Button>
        </section>
      )}
      {!finished && (
        <details className={panel}>
          <summary className="cursor-pointer font-semibold">
            Report a problem
            {detail.canApprove ? " or resolve the remainder" : ""}
          </summary>
          <label className="mt-4 block">
            What happened?
            <textarea
              value={note}
              maxLength={1000}
              className={field}
              onChange={(e) => {
                setNote(e.target.value);
                setKey(crypto.randomUUID());
              }}
            />
          </label>
          {transfer.status !== "requested" && (
            <Button
              className="mt-3"
              variant="secondary"
              disabled={busy || !online || note.trim().length < 3}
              onClick={() => void act("report_problem", { note })}
            >
              Ask administrator to review
            </Button>
          )}
          {detail.canApprove && (
            <div className="mt-4 space-y-3">
              <label className="block">
                Administrator decision
                <select
                  className={field}
                  value={disposition}
                  onChange={(e) => {
                    setDisposition(e.target.value);
                    setKey(crypto.randomUUID());
                  }}
                >
                  <option value="still_expected">
                    Keep expecting the remainder / acknowledge resolved issue
                  </option>
                  <option value="never_left">
                    Cancel remainder — confirm it is still at the source
                  </option>
                  {transfer.status !== "requested" && (
                    <option value="lost">
                      Remainder left the source and is confirmed lost
                    </option>
                  )}
                </select>
              </label>
              <p className="text-sm text-[var(--muted)]">
                Cancelling releases stock only when you confirm it never left.
                Confirmed lost goods are removed from source stock and recorded
                as a loss. Approved branch-request demand stays outstanding.
              </p>
              <Button
                disabled={
                  busy ||
                  !online ||
                  note.trim().length < 3 ||
                  (transfer.status === "requested" &&
                    disposition !== "never_left")
                }
                onClick={() => void act("resolve", { disposition, note })}
              >
                Save administrator decision
              </Button>
            </div>
          )}
        </details>
      )}
      <details className={panel}>
        <summary className="cursor-pointer font-semibold">
          Receipt and action history
        </summary>
        <ol className="mt-4 space-y-3">
          {detail.events.map((e) => (
            <li
              key={e.id}
              className="border-l-2 border-emerald-200 pl-3 text-sm"
            >
              <strong>
                {(
                  {
                    created: "Stock requested",
                    approve: "Administrator approved",
                    receive: "Receipt recorded",
                    report_problem: "Problem reported",
                    resolve: "Administrator decision",
                  } as Record<string, string>
                )[e.action] ?? e.action}
              </strong>
              <span className="ml-2 text-[var(--muted)]">
                {new Date(e.createdAt).toLocaleString()}
              </span>
              {e.note && <p>{e.note}</p>}
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

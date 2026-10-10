"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { AppDialog } from "@/components/ui/app-dialog";
import {
  PaginatedTableControls,
  useTablePagination,
} from "@/components/ui/table-pagination";
import { useDialogFocus } from "@/components/ui/use-dialog-focus";
import { callAdministration } from "@/features/administration/api";
import { useOrganizationCollection } from "@/features/administration/use-organization-collection";
import { useAuth } from "@/features/auth/auth-context";
import { hasPermission, hasRole } from "@/lib/permissions/roles";
import type {
  InventoryLocation,
  StockCount,
  UserProfile,
} from "@/types/domain";
interface CountItem {
  id: string;
  sku: string;
  trackingType?: "quantity" | "batch" | "serial";
  expectedQuantity?: number;
  countedQuantity?: number;
  variance?: number;
  countedSerialNumbers?: string[];
}
export default function CountsPage() {
  const { profile } = useAuth();
  const counts = useOrganizationCollection<StockCount>("stockCounts");
  const locations =
    useOrganizationCollection<InventoryLocation>("inventoryLocations");
  const users = useOrganizationCollection<UserProfile>("users");
  const [locationId, setLocationId] = useState("");
  const [assignedUserId, setAssignedUserId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<{
    count: StockCount;
    items: CountItem[];
    nextCursor?: string | null;
  } | null>(null);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [pageSize, setPageSize] = useState(25);
  const [pageCursors, setPageCursors] = useState<(string | undefined)[]>([undefined]);
  const [workspacePage, setWorkspacePage] = useState(0);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [serialText, setSerialText] = useState<Record<string, string>>({});
  const countPagination = useTablePagination(counts.data);
  const workspaceRef = useDialogFocus<HTMLElement>(Boolean(workspace), () =>
    setWorkspace(null),
  );
  const canCount = profile ? hasPermission(profile, "inventory.count") : false;
  const canReview = profile
    ? hasPermission(profile, "inventory.count_review")
    : false;
  const canEditWorkspace = Boolean(workspace?.count.status === "in_progress" && profile &&
    (workspace.count.assignedUserIds?.includes(profile.id) || hasRole(profile, "system_administrator")));
  const counterOptions = [
    ...(profile ? [profile] : []),
    ...users.data.filter((item) => item.id !== profile?.id),
  ].filter((item) => item.status === "active");
  async function create() {
    try {
      await callAdministration("createStockCount", {
        locationId,
        assignedUserIds: [assignedUserId],
        blindCount: true,
        countDate: new Date().toISOString().slice(0, 10),
        idempotencyKey: crypto.randomUUID(),
      });
      setMessage("Draft count created.");
    } catch {
      setMessage("Count creation was rejected.");
    }
  }
  async function action(name: string, stockCountId: string) {
    if (pendingAction) return;
    setPendingAction(stockCountId);
    const label = name === "startStockCount" ? "Start count" : name === "reviewStockCount" ? "Review count" : "Post count";
    try {
      await callAdministration(name, {
        stockCountId,
        reason: name === "postStockCount" ? counts.data.find(count => count.id === stockCountId)?.postingReason ?? "Approved physical stock count posted" : `${label} from inventory workspace`,
        idempotencyKey: crypto.randomUUID(),
      });
      setMessage(`${label} completed.`);
      if (name === "startStockCount") await openWorkspace(stockCountId);
    } catch (error) {
      setMessage(`${error instanceof Error ? error.message : `${label} could not be completed.`}${name === "postStockCount" ? " Some lines may already be posted. Resume this same count with its original reason; do not create another count." : ""}`);
    } finally { setPendingAction(null); }
  }
  async function openWorkspace(stockCountId: string) {
    try {
      setQuantities({}); setSerialText({}); setWorkspacePage(0); setPageCursors([undefined]);
      setWorkspace(
        await callAdministration("getStockCountWorkspace", {
          stockCountId,
          reason: "Open workspace",
          idempotencyKey: crypto.randomUUID(),
          limit: pageSize,
        }),
      );
    } catch {
      setMessage("Unable to open count workspace.");
    }
  }
  async function savePage(saveOnly: boolean) {
    if (!workspace) return false;
    const filled = workspace.items.filter(item => String(quantities[item.id] ?? item.countedQuantity ?? "").trim() !== "");
    if (!saveOnly && filled.length !== workspace.items.length) throw new Error("Enter a physical count for every line on this page. Enter 0 explicitly when none are found.");
    if (!filled.length) { if (saveOnly) return true; throw new Error("There are no quantities to submit."); }
    await callAdministration("submitStockCount", {
      stockCountId: workspace.count.id, reason: saveOnly ? "Physical count page saved" : "Physical count submitted",
      idempotencyKey: crypto.randomUUID(), saveOnly,
      items: filled.map(item => ({
        itemId: item.id, countedQuantity: Number(quantities[item.id] ?? item.countedQuantity),
        serialNumbers: item.trackingType === "serial" ? (serialText[item.id] ?? item.countedSerialNumbers?.join("\n") ?? "").split(/[\n,]+/).map(value => value.trim()).filter(Boolean) : [],
      })),
    });
    return true;
  }
  async function changePage(nextPage: number, size = pageSize) {
    if (!workspace || workspaceBusy) return;
    setWorkspaceBusy(true);
    try {
      if (canEditWorkspace) await savePage(true);
      const cursor = size !== pageSize ? undefined : nextPage > workspacePage ? workspace.nextCursor ?? undefined : pageCursors[nextPage];
      const result = await callAdministration<object, NonNullable<typeof workspace>>("getStockCountWorkspace", {
        stockCountId: workspace.count.id,
        reason: "Open count page", limit: size, ...(cursor ? { cursor } : {}),
        idempotencyKey: crypto.randomUUID(),
      });
      setPageCursors(current => size !== pageSize ? [undefined] : Object.assign([...current], { [nextPage]: cursor }));
      setWorkspace(result); setWorkspacePage(nextPage); setPageSize(size);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to save or open this count page. Your inputs are retained."); }
    finally { setWorkspaceBusy(false); }
  }
  async function submit(saveOnly = false) {
    if (!workspace || workspaceBusy) return;
    setWorkspaceBusy(true);
    try {
      await savePage(saveOnly);
      setMessage(saveOnly ? "This page is saved. Continue counting the other pages." : "Complete count submitted without changing inventory.");
      if (!saveOnly) setWorkspace(null);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Count submission was rejected. Your inputs are retained."); }
    finally { setWorkspaceBusy(false); }
  }
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-semibold">Stock counts</h1>
        <p className="text-[var(--muted)]">
          Blind count, auditable review, and ledger-posted variances. Assigned
          managers may complete the review without waiting for another user.
        </p>
      </div>
      {message && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm">{message}</p>
      )}
      {canCount && (
        <section className="grid gap-3 rounded-xl border bg-white p-4 md:grid-cols-[1fr_1fr_auto]">
          <select
            value={locationId}
            onChange={(event) => setLocationId(event.target.value)}
            className="rounded-lg border p-2.5"
          >
            <option value="">Count location…</option>
            {locations.data.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <select
            value={assignedUserId}
            onChange={(event) => setAssignedUserId(event.target.value)}
            className="rounded-lg border p-2.5"
          >
            <option value="">Assigned counter…</option>
            {counterOptions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.displayName}
              </option>
            ))}
          </select>
          <Button disabled={!locationId || !assignedUserId} onClick={create}>
            Create draft
          </Button>
        </section>
      )}
      <div className="responsive-table-wrap">
        <table className="responsive-table">
          <thead>
            <tr>
              {["Count", "Location", "Date", "Status", "Actions"].map(
                (item) => (
                  <th key={item} className="px-4 py-3">
                    {item}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {countPagination.rows.map((count) => (
              <tr key={count.id} className="border-t">
                <td
                  data-label="Count"
                  data-primary="true"
                  className="px-4 py-3 font-mono"
                >
                  {count.countNumber}
                </td>
                <td data-label="Location" className="px-4">
                  {locations.data.find((item) => item.id === count.locationId)
                    ?.name ?? count.locationId}
                </td>
                <td data-label="Date" className="px-4">
                  {count.countDate}
                </td>
                <td data-label="Status" className="px-4 capitalize">
                  {count.status.replaceAll("_", " ")}
                  {count.status === "reviewed" && count.postingEffectiveAt && <p className="mt-1 text-xs normal-case text-amber-800">Posting started. Resume this count to finish safely.</p>}
                </td>
                <td
                  data-label="Actions"
                  data-actions="true"
                  className="flex flex-wrap gap-1 px-4 py-2"
                >
                  <Button
                    variant="ghost"
                    onClick={() => openWorkspace(count.id)}
                  >
                    Open
                  </Button>
                  {count.status === "draft" && canCount && (
                    <Button
                      variant="ghost"
                      onClick={() => action("startStockCount", count.id)}
                      disabled={Boolean(pendingAction)}
                    >
                      Start
                    </Button>
                  )}
                  {count.status === "submitted" && canReview && (
                    <Button
                      variant="ghost"
                      onClick={() => action("reviewStockCount", count.id)}
                      disabled={Boolean(pendingAction)}
                    >
                      Review
                    </Button>
                  )}
                  {count.status === "reviewed" && canReview && (
                    <Button
                      variant="ghost"
                      onClick={() => action("postStockCount", count.id)}
                      disabled={Boolean(pendingAction)}
                    >
                      {pendingAction === count.id ? "Posting…" : count.postingEffectiveAt ? "Resume posting" : "Post"}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {counts.data.length > 0 && (
        <PaginatedTableControls
          pagination={countPagination}
          total={counts.data.length}
          itemLabel="stock counts"
        />
      )}
      {workspace && (
        <AppDialog
          role="dialog"
          aria-modal="true"
          aria-labelledby="stock-count-title"
        >
          <section
            ref={workspaceRef}
            className="app-dialog-panel safe-bottom max-w-3xl rounded-2xl bg-white p-5 sm:p-6"
          >
            <h2 id="stock-count-title" className="text-xl font-semibold">
              {workspace.count.countNumber}
            </h2>
            <p className="text-sm text-[var(--muted)]">
              {workspace.count.blindCount
                ? "Blind-count mode"
                : "Visible expected quantities"}{" "}
              · {workspace.count.status}
            </p>
            <p className="mt-2 text-sm text-[var(--muted)]">Save progress by page. Blank quantities are not counted as zero. Submit only after every item has been counted.</p>
            {message && <p role="status" className="mt-2 rounded-lg bg-amber-50 p-3 text-sm">{message}</p>}
            <div className="responsive-table-wrap mt-4 max-h-[55vh] overflow-auto">
              <table className="responsive-table">
                <thead>
                  <tr>
                    <th className="py-2">SKU</th>
                    {workspace.items.some(
                      (item) => item.expectedQuantity !== undefined,
                    ) && <th>Expected</th>}
                    <th>Counted</th>
                    <th>Variance</th>
                    <th>Serial numbers</th>
                  </tr>
                </thead>
                <tbody>
                  {workspace.items.map((item) => (
                    <tr key={item.id} className="border-t">
                      <td
                        data-label="SKU"
                        data-primary="true"
                        className="py-2 font-mono"
                      >
                        {item.sku}
                      </td>
                      {item.expectedQuantity !== undefined && (
                        <td data-label="Expected">{item.expectedQuantity}</td>
                      )}
                      <td data-label="Counted">
                        <input
                          type="number"
                          min="0"
                          value={
                            quantities[item.id] ?? item.countedQuantity ?? ""
                          }
                          onChange={(event) =>
                            setQuantities((current) => ({
                              ...current,
                              [item.id]: event.target.value,
                            }))
                          }
                          disabled={workspaceBusy || !canEditWorkspace}
                          aria-label={`Counted quantity for ${item.sku}`}
                          className="w-24 rounded border p-2"
                        />
                      </td>
                      <td data-label="Variance">{item.variance ?? "—"}</td>
                      <td data-label="Serial numbers" className="col-span-2">
                        {item.trackingType === "serial" ? (
                          <textarea
                            value={
                              serialText[item.id] ??
                              item.countedSerialNumbers?.join("\n") ??
                              ""
                            }
                            onChange={(event) =>
                              setSerialText((current) => ({
                                ...current,
                                [item.id]: event.target.value,
                              }))
                            }
                            disabled={workspaceBusy || !canEditWorkspace}
                            placeholder="One serial per line"
                            className="min-w-48 rounded border p-2"
                          />
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <nav aria-label="Count item pages" className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
              <label>Items per page <select aria-label="Count items per page" value={pageSize} disabled={workspaceBusy} onChange={event => changePage(0, Number(event.target.value))} className="rounded-lg border p-2">{[25, 50, 100].map(size => <option key={size} value={size}>{size}</option>)}</select></label>
              <span>Page {workspacePage + 1} · {workspace.items.length} items</span>
              <div className="flex gap-2"><Button variant="secondary" disabled={workspaceBusy || workspacePage === 0} onClick={() => changePage(workspacePage - 1)}>Previous items</Button><Button variant="secondary" disabled={workspaceBusy || !workspace.nextCursor} onClick={() => changePage(workspacePage + 1)}>Next items</Button></div>
            </nav>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" disabled={workspaceBusy} onClick={() => setWorkspace(null)}>
                Close
              </Button>
              {canEditWorkspace && (
                <><Button variant="secondary" disabled={workspaceBusy} onClick={() => submit(true)}>Save this page</Button><Button disabled={workspaceBusy} onClick={() => submit(false)}>Submit complete count</Button></>
              )}
            </div>
          </section>
        </AppDialog>
      )}
    </div>
  );
}

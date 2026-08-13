"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useDialogFocus } from "@/components/ui/use-dialog-focus";
import { callAdministration } from "@/features/administration/api";
import { useOrganizationCollection } from "@/features/administration/use-organization-collection";
import { useAuth } from "@/features/auth/auth-context";
import { hasPermission } from "@/lib/permissions/roles";
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
  const [workspace, setWorkspace] = useState<{
    count: StockCount;
    items: CountItem[];
  } | null>(null);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [serialText, setSerialText] = useState<Record<string, string>>({});
  const workspaceRef = useDialogFocus<HTMLElement>(Boolean(workspace), () =>
    setWorkspace(null),
  );
  const canCount = profile ? hasPermission(profile, "inventory.count") : false;
  const canReview = profile
    ? hasPermission(profile, "inventory.count_review")
    : false;
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
    try {
      await callAdministration(name, {
        stockCountId,
        reason: `${name} from inventory workspace`,
        idempotencyKey: crypto.randomUUID(),
      });
      setMessage(`${name} completed.`);
      if (name === "startStockCount") await openWorkspace(stockCountId);
    } catch {
      setMessage(`${name} was rejected by workflow controls.`);
    }
  }
  async function openWorkspace(stockCountId: string) {
    try {
      setWorkspace(
        await callAdministration("getStockCountWorkspace", {
          stockCountId,
          reason: "Open workspace",
          idempotencyKey: crypto.randomUUID(),
        }),
      );
    } catch {
      setMessage("Unable to open count workspace.");
    }
  }
  async function submit() {
    if (!workspace) return;
    try {
      await callAdministration("submitStockCount", {
        stockCountId: workspace.count.id,
        reason: "Physical count submitted",
        idempotencyKey: crypto.randomUUID(),
        items: workspace.items.map((item) => ({
          itemId: item.id,
          countedQuantity: Number(
            quantities[item.id] ?? item.countedQuantity ?? 0,
          ),
          serialNumbers:
            item.trackingType === "serial"
              ? (
                  serialText[item.id] ??
                  item.countedSerialNumbers?.join("\n") ??
                  ""
                )
                  .split(/[\n,]+/)
                  .map((value) => value.trim())
                  .filter(Boolean)
              : [],
        })),
      });
      setMessage("Count submitted without changing inventory.");
      setWorkspace(null);
    } catch {
      setMessage("Count submission was rejected.");
    }
  }
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-semibold">Stock counts</h1>
        <p className="text-[var(--muted)]">
          Blind count, maker-checker review, and ledger-posted variances.
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
            {counts.data.map((count) => (
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
                    >
                      Start
                    </Button>
                  )}
                  {count.status === "submitted" && canReview && (
                    <Button
                      variant="ghost"
                      onClick={() => action("reviewStockCount", count.id)}
                    >
                      Review
                    </Button>
                  )}
                  {count.status === "reviewed" && canReview && (
                    <Button
                      variant="ghost"
                      onClick={() => action("postStockCount", count.id)}
                    >
                      Post
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {workspace && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/50 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="stock-count-title"
        >
          <section ref={workspaceRef} className="safe-bottom max-h-[calc(100dvh-1rem)] w-full max-w-3xl overflow-y-auto rounded-t-2xl bg-white p-5 sm:my-8 sm:rounded-xl sm:p-6">
            <h2 id="stock-count-title" className="text-xl font-semibold">
              {workspace.count.countNumber}
            </h2>
            <p className="text-sm text-[var(--muted)]">
              {workspace.count.blindCount
                ? "Blind-count mode"
                : "Visible expected quantities"}{" "}
              · {workspace.count.status}
            </p>
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
                          disabled={workspace.count.status !== "in_progress"}
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
                            disabled={workspace.count.status !== "in_progress"}
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
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setWorkspace(null)}>
                Close
              </Button>
              {workspace.count.status === "in_progress" && (
                <Button onClick={submit}>Submit count</Button>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

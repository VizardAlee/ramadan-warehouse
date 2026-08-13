"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { useDialogFocus } from "@/components/ui/use-dialog-focus";
import { useAuth } from "@/features/auth/auth-context";
import { hasPermission } from "@/lib/permissions/roles";
import type { PermissionId, UserProfile } from "@/types/domain";
import { callAdministration } from "./api";
import { eligibleManagers } from "./manager-options";
import { useOrganizationCollection } from "./use-organization-collection";

const schema = z.object({
  name: z.string().trim().min(2),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,24}$/),
  state: z.string().optional(),
  address: z.string().optional(),
  contactPhone: z.string().optional(),
  managerUserId: z.string().optional(),
  managerIds: z.array(z.string()),
  status: z.enum(["active", "inactive"]),
  type: z
    .enum([
      "warehouse",
      "branch",
      "goods_in_transit",
      "damaged",
      "quarantined",
      "returned",
    ])
    .optional(),
  relatedId: z.string().optional(),
  systemManaged: z.boolean(),
});
type Values = z.infer<typeof schema>;
interface Row extends Values {
  id: string;
  warehouseId?: string;
  branchId?: string;
}
const defaults: Values = {
  name: "",
  code: "",
  state: "",
  address: "",
  contactPhone: "",
  managerUserId: "",
  managerIds: [],
  status: "active",
  systemManaged: false,
};
const configuration = {
  branches: {
    title: "Branches",
    callable: "saveBranch",
    permission: "branch.manage",
  },
  warehouses: {
    title: "Warehouses",
    callable: "saveWarehouse",
    permission: "warehouse.manage",
  },
  inventoryLocations: {
    title: "Inventory Locations",
    callable: "saveInventoryLocation",
    permission: "location.manage",
  },
} as const satisfies Record<
  string,
  { title: string; callable: string; permission: PermissionId }
>;

export function MasterDataPage({
  collectionName,
}: {
  collectionName: keyof typeof configuration;
}) {
  const { profile } = useAuth();
  const config = configuration[collectionName];
  const records = useOrganizationCollection<Row>(collectionName);
  const branches = useOrganizationCollection<Row>("branches");
  const warehouses = useOrganizationCollection<Row>("warehouses");
  const users = useOrganizationCollection<UserProfile>("users");
  const branchManagers = eligibleManagers(users.data, "branch_manager");
  const warehouseManagers = eligibleManagers(users.data, "warehouse_manager");
  const canManage = profile ? hasPermission(profile, config.permission) : false;
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useDialogFocus<HTMLFormElement>(open, () => setOpen(false));
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
  });
  const type = useWatch({ control, name: "type" });
  function edit(row?: Row) {
    setEditing(row ?? null);
    reset(
      row
        ? {
            ...row,
            managerIds: row.managerIds ?? [],
            relatedId: row.branchId ?? row.warehouseId,
          }
        : {
            ...defaults,
            type:
              collectionName === "inventoryLocations" ? "warehouse" : undefined,
          },
    );
    setOpen(true);
  }
  const submit = handleSubmit(async (values) => {
    setError(null);
    try {
      const sanitized = Object.fromEntries(
        Object.entries(values).filter(
          ([, value]) => value !== "" && value !== undefined,
        ),
      );
      const owner =
        values.type === "branch"
          ? { branchId: values.relatedId }
          : values.type === "warehouse"
            ? { warehouseId: values.relatedId }
            : {};
      await callAdministration(config.callable, {
        ...sanitized,
        ...owner,
        id: editing?.id,
        idempotencyKey: crypto.randomUUID(),
      });
      setOpen(false);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The server rejected this configuration change.",
      );
    }
  });
  function relationship(row: Row) {
    if (collectionName === "branches")
      return (
        users.data.find((user) => user.id === row.managerUserId)?.displayName ??
        "No manager"
      );
    if (collectionName === "warehouses")
      return (
        row.managerIds
          .map(
            (id) =>
              users.data.find((user) => user.id === id)?.displayName ?? id,
          )
          .join(", ") || "No managers"
      );
    return (
      branches.data.find((branch) => branch.id === row.branchId)?.name ??
      warehouses.data.find((warehouse) => warehouse.id === row.warehouseId)
        ?.name ??
      "Organization virtual"
    );
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">{config.title}</h1>
          <p className="page-description">
            Organization-scoped administrative master data.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => edit()}>
            <Plus className="size-4" />
            Create
          </Button>
        )}
      </div>
      {(error || records.error) && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error ?? records.error}
        </p>
      )}
      <div className="responsive-table-wrap">
        <table className="responsive-table">
          <thead className="bg-slate-50">
            <tr>
              <th>Name</th>
              <th>Code</th>
              <th>Type / State</th>
              <th>Manager / Related location</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {records.loading ? (
              <tr>
                <td colSpan={6} className="p-8 text-center">
                  Loading…
                </td>
              </tr>
            ) : records.data.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-[var(--muted)]">
                  No records configured.
                </td>
              </tr>
            ) : (
              records.data.map((row) => (
                <tr key={row.id}>
                  <td
                    data-label="Name"
                    data-primary="true"
                    className="font-medium"
                  >
                    {row.name}
                    {row.systemManaged && (
                      <span className="ml-2 text-xs text-amber-700">
                        System managed
                      </span>
                    )}
                  </td>
                  <td data-label="Code" className="font-mono">
                    {row.code}
                  </td>
                  <td data-label="Type / State" className="capitalize">
                    {row.type?.replaceAll("_", " ") ?? row.state ?? "—"}
                  </td>
                  <td data-label="Manager / Related">{relationship(row)}</td>
                  <td data-label="Status">
                    <StatusBadge status={row.status} />
                  </td>
                  <td data-label="Actions" data-actions="true">
                    {canManage && (
                      <Button variant="ghost" onClick={() => edit(row)}>
                        Edit
                      </Button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="master-data-dialog-title"
        >
          <form
            ref={dialogRef}
            onSubmit={submit}
            className="safe-bottom max-h-[calc(100dvh-1rem)] w-full max-w-xl space-y-4 overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl sm:p-6"
          >
            <h2 id="master-data-dialog-title" className="text-xl font-semibold">
              {editing ? "Edit" : "Create"} {config.title}
            </h2>
            <div className="form-grid">
              <label className="text-sm">
                Name
                <input
                  {...register("name")}
                  className="mt-1 w-full rounded-lg border p-2.5"
                />
                {errors.name && (
                  <span className="mt-1 block text-xs text-red-700">
                    Enter a name of at least two characters.
                  </span>
                )}
              </label>
              <label className="text-sm">
                Code
                <input
                  {...register("code")}
                  className="mt-1 w-full rounded-lg border p-2.5 uppercase"
                />
                {errors.code && (
                  <span className="mt-1 block text-xs text-red-700">
                    Use 2–24 letters, numbers, underscores, or hyphens.
                  </span>
                )}
              </label>
              {collectionName !== "inventoryLocations" && (
                <>
                  <label className="text-sm">
                    State
                    <input
                      {...register("state")}
                      className="mt-1 w-full rounded-lg border p-2.5"
                    />
                  </label>
                  <label className="text-sm">
                    Address
                    <input
                      {...register("address")}
                      className="mt-1 w-full rounded-lg border p-2.5"
                    />
                  </label>
                </>
              )}
              {collectionName === "branches" && (
                <>
                  <label className="text-sm">
                    Contact phone (optional)
                    <input
                      type="tel"
                      inputMode="tel"
                      {...register("contactPhone")}
                      className="mt-1 w-full rounded-lg border p-2.5"
                    />
                  </label>
                  <label className="text-sm">
                    Manager
                    <select
                      {...register("managerUserId")}
                      className="mt-1 w-full rounded-lg border p-2.5"
                    >
                      <option value="">No manager</option>
                      {branchManagers.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              {collectionName === "warehouses" && (
                <label className="text-sm">
                  Managers
                  <select
                    multiple
                    {...register("managerIds")}
                    className="mt-1 h-32 w-full rounded-lg border p-2.5"
                  >
                    {warehouseManagers.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.displayName}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {collectionName === "inventoryLocations" && (
                <>
                  <label className="text-sm">
                    Location type
                    <select
                      {...register("type")}
                      className="mt-1 w-full rounded-lg border p-2.5"
                    >
                      <option value="warehouse">warehouse</option>
                      <option value="branch">branch</option>
                      <option value="goods_in_transit">goods in transit</option>
                      <option value="damaged">damaged</option>
                      <option value="quarantined">quarantined</option>
                      <option value="returned">returned</option>
                    </select>
                  </label>
                  {(type === "branch" || type === "warehouse") && (
                    <label className="text-sm">
                      Related {type}
                      <select
                        {...register("relatedId")}
                        className="mt-1 w-full rounded-lg border p-2.5"
                      >
                        <option value="">Select…</option>
                        {(type === "branch"
                          ? branches.data
                          : warehouses.data
                        ).map((row) => (
                          <option key={row.id} value={row.id}>
                            {row.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label className="flex min-h-11 items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      {...register("systemManaged")}
                      className="size-5"
                    />
                    System managed
                  </label>
                </>
              )}
              <label className="text-sm">
                Status
                <select
                  {...register("status")}
                  className="mt-1 w-full rounded-lg border p-2.5"
                >
                  <option>active</option>
                  <option>inactive</option>
                </select>
              </label>
            </div>
            <div className="sticky bottom-0 flex justify-end gap-3 border-t bg-white pt-4">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                Save securely
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

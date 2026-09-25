"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { AppDialog } from "@/components/ui/app-dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  PaginatedTableControls,
  useTablePagination,
} from "@/components/ui/table-pagination";
import { useDialogFocus } from "@/components/ui/use-dialog-focus";
import { useAuth } from "@/features/auth/auth-context";
import { hasPermission } from "@/lib/permissions/roles";
import type { PermissionId, UserProfile } from "@/types/domain";
import { callAdministration } from "./api";
import { eligibleManagers } from "./manager-options";
import { useOrganizationCollection } from "./use-organization-collection";

const schema = z.object({
  name: z.string().trim().min(2),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{2,24}$/),
  state: z.string().optional(),
  address: z.string().optional(),
  branchType: z.enum(["head_office", "store"]).optional(),
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
  branchType: "store",
  systemManaged: false,
};
const configuration = {
  branches: {
    title: "Stores & Head Office",
    callable: "saveBranch",
    permission: "branch.manage",
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
  const users = useOrganizationCollection<UserProfile>("users");
  const branchManagers = eligibleManagers(users.data, "branch_manager");
  const canManage = profile ? hasPermission(profile, config.permission) : false;
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);
  const visibleRecords =
    collectionName === "inventoryLocations"
      ? records.data.filter((row) => row.type !== "warehouse")
      : records.data;
  const pagination = useTablePagination(visibleRecords);
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
              collectionName === "inventoryLocations" ? "branch" : undefined,
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
        values.type === "branch" && values.relatedId
          ? { branchId: values.relatedId }
          : {};
      await callAdministration(config.callable, {
        ...sanitized,
        ...owner,
        ...(editing ? { id: editing.id } : {}),
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
    return (
      branches.data.find((branch) => branch.id === row.branchId)?.name ??
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
            ) : visibleRecords.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-[var(--muted)]">
                  No records configured.
                </td>
              </tr>
            ) : (
              pagination.rows.map((row) => (
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
                    {collectionName === "branches"
                      ? (row.branchType ?? "store").replaceAll("_", " ")
                      : row.type?.replaceAll("_", " ") ?? row.state ?? "—"}
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
      {!records.loading && visibleRecords.length > 0 && (
        <PaginatedTableControls
          pagination={pagination}
          total={visibleRecords.length}
          itemLabel={collectionName.replaceAll(/([A-Z])/g, " $1").toLowerCase()}
        />
      )}
      {open && (
        <AppDialog
          role="dialog"
          aria-modal="true"
          aria-labelledby="master-data-dialog-title"
        >
          <form
            ref={dialogRef}
            onSubmit={submit}
            className="app-dialog-panel safe-bottom max-w-xl space-y-4 rounded-2xl bg-white p-5 sm:p-6"
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
                    Operating role
                    <select
                      {...register("branchType")}
                      className="mt-1 w-full rounded-lg border p-2.5"
                    >
                      <option value="store">Store / branch</option>
                      <option value="head_office">
                        Head office / central distribution
                      </option>
                    </select>
                    <span className="mt-1 block text-xs text-[var(--muted)]">
                      Head office can sell to customers and distribute stock to
                      other stores.
                    </span>
                  </label>
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
              {collectionName === "inventoryLocations" && (
                <>
                  <label className="text-sm">
                    Location type
                    <select
                      {...register("type")}
                      className="mt-1 w-full rounded-lg border p-2.5"
                    >
                      <option value="branch">store stock</option>
                      <option value="goods_in_transit">goods in transit</option>
                      <option value="damaged">damaged</option>
                      <option value="quarantined">quarantined</option>
                      <option value="returned">returned</option>
                    </select>
                  </label>
                  {type === "branch" && (
                    <label className="text-sm">
                      Related store
                      <select
                        {...register("relatedId")}
                        className="mt-1 w-full rounded-lg border p-2.5"
                      >
                        <option value="">Select…</option>
                        {branches.data.map((row) => (
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
        </AppDialog>
      )}
    </div>
  );
}

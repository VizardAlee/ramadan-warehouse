"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { MailPlus, Search, UserPlus } from "lucide-react";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { useDialogFocus } from "@/components/ui/use-dialog-focus";
import { useAuth } from "@/features/auth/auth-context";
import { callAdministration } from "@/features/administration/api";
import { useOrganizationCollection } from "@/features/administration/use-organization-collection";
import { hasPermission, roleIdsForProfile } from "@/lib/permissions/roles";
import {
  type DateTimeValue,
  roleIds,
  type Branch,
  type UserProfile,
  type Warehouse,
} from "@/types/domain";

function dateValue(value: DateTimeValue | undefined) {
  if (!value) return null;
  const date = typeof value === "string" ? new Date(value) : new Date(value.seconds * 1_000);
  return Number.isNaN(date.valueOf()) ? null : date;
}

function invitationLabel(user: UserProfile) {
  if (user.invitationStatus === "accepted") return "Invitation accepted";
  if (user.invitationStatus === "pending") {
    const expiresAt = dateValue(user.invitationExpiresAt);
    return expiresAt && expiresAt.valueOf() <= Date.now() ? "Invitation expired" : "Invitation pending";
  }
  return null;
}

const formSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(2),
  phoneNumber: z
    .union([
      z.string().regex(/^0[789]\d{9}$/),
      z.string().regex(/^\+234[789]\d{9}$/),
      z.literal(""),
    ])
    .optional(),
  employeeReference: z.string().optional(),
  roleIds: z.array(z.enum(roleIds)).min(1),
  branchIds: z.array(z.string()),
  warehouseIds: z.array(z.string()),
  status: z.enum(["active", "inactive", "suspended"]),
});
type Values = z.infer<typeof formSchema>;
const defaults: Values = {
  email: "",
  displayName: "",
  phoneNumber: "",
  employeeReference: "",
  roleIds: ["branch_requester"],
  branchIds: [],
  warehouseIds: [],
  status: "active",
};

export default function UsersPage() {
  const { profile, user: authenticatedUser } = useAuth();
  const users = useOrganizationCollection<UserProfile>("users");
  const branches = useOrganizationCollection<Branch>("branches");
  const warehouses = useOrganizationCollection<Warehouse>("warehouses");
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [branchId, setBranchId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [editing, setEditing] = useState<UserProfile | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [invitationLink, setInvitationLink] = useState<string | null>(null);
  const [reissuingUserId, setReissuingUserId] = useState<string | null>(null);
  const dialogRef = useDialogFocus<HTMLFormElement>(showForm, () =>
    setShowForm(false),
  );
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(formSchema),
    defaultValues: defaults,
  });
  const allowed = profile ? hasPermission(profile, "user.manage") : false;
  const filtered = useMemo(
    () =>
      users.data.filter(
        (user) =>
          (!search ||
            `${user.displayName} ${user.email}`
              .toLowerCase()
              .includes(search.toLowerCase())) &&
          (!role || roleIdsForProfile(user).includes(role as (typeof roleIds)[number])) &&
          (!status || user.status === status) &&
          (!branchId || user.branchIds.includes(branchId)) &&
          (!warehouseId || user.warehouseIds.includes(warehouseId)),
      ),
    [users.data, search, role, status, branchId, warehouseId],
  );
  function open(user?: UserProfile) {
    setEditing(user ?? null);
    setInvitationLink(null);
    reset(
      user
        ? {
            email: user.email,
            displayName: user.displayName,
            phoneNumber: user.phoneNumber ?? "",
            employeeReference: user.employeeReference ?? "",
            roleIds: [...roleIdsForProfile(user)],
            branchIds: user.branchIds,
            warehouseIds: user.warehouseIds,
            status: user.status,
          }
        : defaults,
    );
    setShowForm(true);
  }
  const submit = handleSubmit(async (values) => {
    setMessage(null);
    try {
      if (editing)
        await callAdministration("updateOrganizationUser", {
          ...values,
          userId: editing.id,
          email: undefined,
          reason: "Administrative profile update",
          idempotencyKey: crypto.randomUUID(),
        });
      else {
        const result = await callAdministration<
          Values & { idempotencyKey: string },
          { invitationLink: string | null }
        >("createOrganizationUser", {
          ...values,
          idempotencyKey: crypto.randomUUID(),
        });
        setInvitationLink(result.invitationLink);
        setMessage(
          result.invitationLink
            ? "Invitation created. Send the one-time link below through an approved channel. The user cannot sign in until they set their password."
            : "Invitation record created, but no invitation link was returned. The user cannot sign in until an administrator completes the approved invitation-delivery process.",
        );
      }
      setShowForm(false);
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "The secure user operation was rejected. Review assignments and your authority.",
      );
    }
  });
  async function reissueInvitation(user: UserProfile) {
    setMessage(null);
    setInvitationLink(null);
    setReissuingUserId(user.id);
    try {
      const result = await callAdministration<
        { userId: string; idempotencyKey: string },
        { invitationLink: string | null; invitationExpiresAt: string | null }
      >("reissueOrganizationUserInvitation", {
        userId: user.id,
        idempotencyKey: crypto.randomUUID(),
      });
      setInvitationLink(result.invitationLink);
      setMessage(
        result.invitationLink
          ? `A fresh one-time invitation link was issued for ${user.displayName}. Send it through an approved channel; the previous expired link should not be reused.`
          : "The invitation was already re-issued for this request. Refresh before trying again.",
      );
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "The invitation could not be re-issued.",
      );
    } finally {
      setReissuingUserId(null);
    }
  }
  if (!allowed)
    return (
      <div className="rounded-xl border bg-white p-8">
        <h1 className="text-2xl font-semibold">Users</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          You do not have user-management permission.
        </p>
      </div>
    );
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Users</h1>
          <p className="page-description">
            Invite approved users and control their organization assignments.
          </p>
        </div>
        <Button onClick={() => open()}>
          <UserPlus className="size-4" />
          Invite user
        </Button>
      </div>
      <div className="filter-grid rounded-xl border bg-white p-4">
        <label className="relative">
          <span className="sr-only">Search users</span>
          <Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search users"
            className="w-full rounded-lg border py-2.5 pl-9 pr-3"
          />
        </label>
        <label>
          <span className="sr-only">Filter by role</span>
          <select
            value={role}
            onChange={(event) => setRole(event.target.value)}
            className="w-full rounded-lg border px-3"
          >
            <option value="">All roles</option>
            {roleIds.map((id) => (
              <option key={id} value={id}>
                {id.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Filter by status</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="w-full rounded-lg border px-3"
          >
            <option value="">All statuses</option>
            <option>active</option>
            <option>inactive</option>
            <option>suspended</option>
          </select>
        </label>
        <label>
          <span className="sr-only">Filter by branch</span>
          <select
            value={branchId}
            onChange={(event) => setBranchId(event.target.value)}
            className="w-full rounded-lg border px-3"
          >
            <option value="">All branches</option>
            {branches.data.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Filter by warehouse</span>
          <select
            value={warehouseId}
            onChange={(event) => setWarehouseId(event.target.value)}
            className="w-full rounded-lg border px-3"
          >
            <option value="">All warehouses</option>
            {warehouses.data.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {message && (
        <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          <p>{message}</p>
          {invitationLink && (
            <div className="mt-2 flex gap-2">
              <input
                aria-label="One-time invitation link"
                readOnly
                value={invitationLink}
                className="min-w-0 flex-1 rounded border bg-white px-2 py-1 font-mono text-xs"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => navigator.clipboard.writeText(invitationLink)}
              >
                Copy
              </Button>
            </div>
          )}
        </div>
      )}
      {users.error && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {users.error}
        </p>
      )}
      <div className="responsive-table-wrap">
        <table className="responsive-table">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              {[
                "User",
                "Roles",
                "Branches",
                "Warehouses",
                "Status",
                "Actions",
              ].map((label) => (
                <th key={label}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.loading ? (
              <tr>
                <td colSpan={6} className="p-8 text-center">
                  Loading users…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-[var(--muted)]">
                  No users match these filters.
                </td>
              </tr>
            ) : (
              filtered.map((user) => (
                <tr key={user.id}>
                  <td data-label="User" data-primary="true">
                    <strong>{user.displayName}</strong>
                    <span className="block break-all text-xs text-[var(--muted)]">
                      {user.email}
                    </span>
                  </td>
                  <td data-label="Roles" className="capitalize">
                    {roleIdsForProfile(user)
                      .map((roleId) => roleId.replaceAll("_", " "))
                      .join(", ")}
                  </td>
                  <td data-label="Branches">{user.branchIds.length}</td>
                  <td data-label="Warehouses">{user.warehouseIds.length}</td>
                  <td data-label="Status">
                    <StatusBadge status={user.status} />
                    {invitationLabel(user) && (
                      <span className="mt-1 block text-xs text-[var(--muted)]">
                        {invitationLabel(user)}
                      </span>
                    )}
                  </td>
                  <td data-label="Actions" data-actions="true">
                    <div className="flex flex-wrap justify-end gap-1">
                      {user.id !== authenticatedUser?.uid &&
                        user.status === "active" &&
                        user.invitationStatus !== "accepted" && (
                          <Button
                            variant="ghost"
                            disabled={reissuingUserId === user.id}
                            onClick={() => void reissueInvitation(user)}
                          >
                            <MailPlus className="size-4" />
                            {reissuingUserId === user.id ? "Issuing…" : "Re-invite"}
                          </Button>
                        )}
                      <Button variant="ghost" onClick={() => open(user)}>
                        Edit
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {showForm && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="user-dialog-title"
        >
          <form
            ref={dialogRef}
            onSubmit={submit}
            className="safe-bottom max-h-[calc(100dvh-1rem)] w-full max-w-2xl space-y-4 overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl sm:p-6"
          >
            <div>
              <h2 id="user-dialog-title" className="text-xl font-semibold">
                {editing ? "Edit user" : "Invite user"}
              </h2>
              <p className="text-sm text-[var(--muted)]">
                {editing
                  ? "Assignments are revalidated by the server."
                  : "The user receives access only after accepting the invitation and setting a password."}
              </p>
            </div>
            <div className="form-grid">
              <label className="text-sm">
                Email
                <input
                  type="email"
                  inputMode="email"
                  {...register("email")}
                  disabled={Boolean(editing)}
                  className="mt-1 w-full rounded-lg border p-2.5"
                  aria-invalid={Boolean(errors.email)}
                />
                {errors.email && (
                  <span className="text-xs text-red-700">
                    Valid email required
                  </span>
                )}
              </label>
              <label className="text-sm">
                Display name
                <input
                  {...register("displayName")}
                  className="mt-1 w-full rounded-lg border p-2.5"
                />
              </label>
              <label className="text-sm">
                Phone
                <input
                  type="tel"
                  inputMode="tel"
                  placeholder="07032545288"
                  {...register("phoneNumber")}
                  className="mt-1 w-full rounded-lg border p-2.5"
                />
                {errors.phoneNumber && (
                  <span className="text-xs text-red-700">
                    Use 11 digits, for example 07032545288
                  </span>
                )}
              </label>
              <label className="text-sm">
                Employee reference
                <input
                  {...register("employeeReference")}
                  className="mt-1 w-full rounded-lg border p-2.5"
                />
              </label>
              <fieldset className="rounded-lg border p-3 text-sm">
                <legend className="px-1">Roles</legend>
                <p className="mb-2 text-xs text-[var(--muted)]">
                  Select every role this user should hold.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {roleIds.map((id) => (
                    <label key={id} className="flex items-center gap-2 capitalize">
                      <input type="checkbox" value={id} {...register("roleIds")} />
                      {id.replaceAll("_", " ")}
                    </label>
                  ))}
                </div>
                {errors.roleIds && (
                  <span className="mt-2 block text-xs text-red-700">
                    Select at least one role
                  </span>
                )}
              </fieldset>
              <label className="text-sm">
                Status
                <select
                  {...register("status")}
                  className="mt-1 w-full rounded-lg border p-2.5"
                >
                  <option>active</option>
                  <option>inactive</option>
                  <option>suspended</option>
                </select>
              </label>
              <label className="text-sm">
                Branches
                <select
                  multiple
                  {...register("branchIds")}
                  className="mt-1 h-32 w-full rounded-lg border p-2.5"
                >
                  {branches.data.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                Warehouses
                <select
                  multiple
                  {...register("warehouseIds")}
                  className="mt-1 h-32 w-full rounded-lg border p-2.5"
                >
                  {warehouses.data.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="sticky bottom-0 flex justify-end gap-3 border-t bg-white pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowForm(false)}
              >
                Cancel
              </Button>
              <Button disabled={isSubmitting}>
                {isSubmitting
                  ? "Saving…"
                  : editing
                    ? "Save securely"
                    : "Create invitation"}
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

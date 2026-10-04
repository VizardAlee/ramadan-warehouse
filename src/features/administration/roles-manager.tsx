"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { AppDialog } from "@/components/ui/app-dialog";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { useDialogFocus } from "@/components/ui/use-dialog-focus";
import { callAdministration } from "@/features/administration/api";
import { useOrganizationCollection } from "@/features/administration/use-organization-collection";
import { useAuth } from "@/features/auth/auth-context";
import { hasPermission } from "@/lib/permissions/roles";
import type { CustomRole, PermissionId, RoleId } from "@/types/domain";

type RoleOption = { roleId: RoleId; permissionIds: PermissionId[] };
function label(value: string) { return value.replaceAll("_", " ").replaceAll(".", " · "); }

export function RolesManager() {
  const { profile } = useAuth();
  const canManage = Boolean(profile && hasPermission(profile, "role.manage"));
  const roles = useOrganizationCollection<CustomRole>("roles", canManage);
  const [options, setOptions] = useState<RoleOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<CustomRole | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [baseRoleId, setBaseRoleId] = useState<RoleId>("branch_requester");
  const [selected, setSelected] = useState<PermissionId[]>([]);
  const [status, setStatus] = useState<"active" | "inactive">("active");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const dialogRef = useDialogFocus<HTMLFormElement>(open, () => setOpen(false));
  useEffect(() => {
    if (!canManage) return;
    let active = true;
    void callAdministration<object, { roles: RoleOption[] }>("getAssignableRolePermissions", {}).then((result) => {
      if (active) setOptions(result.roles);
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : "Role permissions could not be loaded.");
    });
    return () => { active = false; };
  }, [canManage]);
  const available = options.find((option) => option.roleId === baseRoleId)?.permissionIds ?? [];
  function start(role?: CustomRole) {
    setEditing(role ?? null);
    setName(role?.name ?? "");
    const base = role?.baseRoleId ?? "branch_requester";
    setBaseRoleId(base);
    setSelected(role?.permissionIds ?? options.find((option) => option.roleId === base)?.permissionIds ?? []);
    setStatus(role?.status ?? "active");
    setReason("");
    setError(null);
    setOpen(true);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await callAdministration("saveOrganizationRole", {
        id: editing?.id,
        name,
        baseRoleId,
        permissionIds: selected,
        status,
        reason: editing ? reason : undefined,
        idempotencyKey: crypto.randomUUID(),
      });
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The role could not be saved.");
    } finally {
      setSaving(false);
    }
  }
  if (!canManage) return <div className="rounded-xl border bg-white p-6">Only authorized administrators can manage roles.</div>;
  return <div className="page-stack">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <PageHeader title="Roles & permissions" description="Create named roles with precise permissions. Changes to an assigned role update its users and leave an audit trail." />
      <Button disabled={!options.length} onClick={() => start()}><Plus className="mr-2 size-4" /> Create role</Button>
    </div>
    {error && !open && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {roles.error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">Roles could not be loaded. Refresh and try again.</p>}
    <section className="space-y-3" aria-label="Custom roles">
      <h2 className="text-lg font-semibold">Organization roles</h2>
      {!roles.loading && !roles.data.length && <p className="rounded-xl border bg-white p-5 text-sm text-[var(--muted)]">No custom roles yet. Create one to choose its permissions, then assign it to users.</p>}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{roles.data.map((role) => <article key={role.id} className="rounded-xl border bg-white p-5">
        <div className="flex items-start justify-between gap-2"><div><h3 className="font-semibold">{role.name}</h3><p className="text-xs text-[var(--muted)]">{label(role.baseRoleId)} scope · {role.status}</p></div><Button variant="outline" size="sm" onClick={() => start(role)}>Edit</Button></div>
        <details className="mt-4 text-sm"><summary className="cursor-pointer font-medium text-[var(--brand)]">{role.permissionIds.length} permissions</summary><ul className="mt-2 space-y-1 text-xs text-[var(--muted)]">{role.permissionIds.map((permission) => <li key={permission}>{label(permission)}</li>)}</ul></details>
      </article>)}</div>
    </section>
    <p className="text-xs text-[var(--muted)]">Built-in roles remain protected. A custom role uses a built-in scope for location rules, but only its selected permissions authorize actions.</p>
    {open && <AppDialog role="dialog" aria-modal="true" aria-label={editing ? "Edit role" : "Create role"}>
      <form ref={dialogRef} onSubmit={(event) => void save(event)} className="app-dialog-panel safe-bottom max-w-2xl space-y-4 rounded-2xl bg-white p-5 sm:p-6">
        <h2 className="text-xl font-semibold">{editing ? `Edit ${editing.name}` : "Create role"}</h2>
        <label className="block text-sm">Role name<input required minLength={2} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full rounded-lg border p-2.5" /></label>
        <label className="block text-sm">Location scope / base profile<select value={baseRoleId} onChange={(event) => { const next = event.target.value as RoleId; setBaseRoleId(next); setSelected(options.find((option) => option.roleId === next)?.permissionIds ?? []); }} className="mt-1 w-full rounded-lg border p-2.5">{options.map((option) => <option key={option.roleId} value={option.roleId}>{label(option.roleId)}</option>)}</select></label>
        <p className="text-xs text-[var(--muted)]">The base profile determines whether the role is organization-wide, store-scoped, or stock-location-scoped. You may remove permissions within that scope; you cannot expand beyond it. To change a role&apos;s scope, first unassign it from users.</p>
        <fieldset className="max-h-64 overflow-auto rounded-lg border p-3"><legend className="px-1 text-sm font-semibold">Permissions ({selected.length})</legend><div className="grid gap-2 sm:grid-cols-2">{available.map((permission) => <label key={permission} className="flex items-start gap-2 text-xs"><input type="checkbox" checked={selected.includes(permission)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, permission] : current.filter((item) => item !== permission))} /><span>{label(permission)}</span></label>)}</div></fieldset>
        <label className="block text-sm">Status<select value={status} onChange={(event) => setStatus(event.target.value as "active" | "inactive")} className="mt-1 w-full rounded-lg border p-2.5"><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
        {editing && <label className="block text-sm">Reason for change<input required minLength={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 w-full rounded-lg border p-2.5" placeholder="Why are you changing this role?" /></label>}
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={saving || !name.trim() || !available.length}>{saving ? "Saving…" : "Save role"}</Button></div>
      </form>
    </AppDialog>}
  </div>;
}

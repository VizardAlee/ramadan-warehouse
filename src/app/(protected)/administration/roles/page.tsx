import { PageHeader } from "@/components/ui/page-header";
import { permissionsForRoles } from "@/lib/permissions/roles";
import { permissionIds, roleIds } from "@/types/domain";

export default function RolesPage() { return <div className="page-stack"><PageHeader title="Roles & permissions" description="Centrally defined and read-only to prevent unsafe permission escalation."/><div className="card-grid">{roleIds.map((role) => <article key={role} className="rounded-xl border bg-white p-5"><h2 className="font-semibold capitalize">{role.replaceAll("_", " ")}</h2><p className="mt-1 text-xs text-[var(--muted)]">Organization role · controlled assignment</p><div className="mt-4 flex flex-wrap gap-2">{permissionIds.filter((permission) => permissionsForRoles([role]).has(permission)).map((permission) => <span key={permission} className="max-w-full break-all rounded-full bg-emerald-50 px-2.5 py-1 text-xs text-emerald-800">{permission}</span>)}</div></article>)}</div></div>; }

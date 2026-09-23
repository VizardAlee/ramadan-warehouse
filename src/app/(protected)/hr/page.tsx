"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { UsersRound, Clock3, Banknote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { callAdministration } from "@/features/administration/api";
import { useOrganizationCollection } from "@/features/administration/use-organization-collection";
import { useAuth } from "@/features/auth/auth-context";
import { hasPermission } from "@/lib/permissions/roles";
import type { Branch, UserProfile } from "@/types/domain";

interface Employee {
  id: string; staffId: string; fullName: string; phone: string | null; email: string | null;
  department: string; jobTitle: string; branchId: string | null; employmentDate: string;
  status: "active" | "on_leave" | "inactive"; userId: string | null; externalAttendanceId: string | null;
  salary?: { monthlySalaryMinor: number; effectiveFrom: string } | null;
}
interface Attendance { id: string; employeeId: string; staffId: string; kind: "clock_in" | "clock_out"; source: string; occurredAt: { seconds?: number; _seconds?: number } | string; }
interface Activity { id: string; employeeId: string; kind: "leave" | "training" | "performance" | "incident" | "note"; occurredOn: string; summary: string }
interface Workspace { employees: Employee[]; attendance: Attendance[]; activities: Activity[]; canViewCompensation: boolean; nextCursor: string | null }
const emptyEmployee = { staffId: "", fullName: "", phone: "", email: "", department: "", jobTitle: "", branchId: "", employmentDate: new Date().toISOString().slice(0, 10), status: "active" as Employee["status"], userId: "", externalAttendanceId: "" };
const money = (minor: number) => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(minor / 100);
const displayTime = (value: Attendance["occurredAt"]) => {
  const millis = typeof value === "string" ? Date.parse(value) : ((value.seconds ?? value._seconds ?? 0) * 1000);
  return Number.isFinite(millis) ? new Date(millis).toLocaleString("en-NG") : "—";
};

export default function HrPage() {
  const { profile } = useAuth();
  const branches = useOrganizationCollection<Branch>("branches");
  const users = useOrganizationCollection<UserProfile>("users");
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pageSize, setPageSize] = useState(25);
  const [pageCursors, setPageCursors] = useState<Array<string | null>>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [employee, setEmployee] = useState({ ...emptyEmployee });
  const [salaryEmployeeId, setSalaryEmployeeId] = useState("");
  const [salaryNaira, setSalaryNaira] = useState("");
  const [salaryDate, setSalaryDate] = useState(new Date().toISOString().slice(0, 10));
  const [salaryReason, setSalaryReason] = useState("");
  const [attendanceEmployeeId, setAttendanceEmployeeId] = useState("");
  const [attendanceKind, setAttendanceKind] = useState<"clock_in" | "clock_out">("clock_in");
  const [attendanceTime, setAttendanceTime] = useState("");
  const [attendanceReason, setAttendanceReason] = useState("");
  const [activityEmployeeId, setActivityEmployeeId] = useState("");
  const [activityKind, setActivityKind] = useState<Activity["kind"]>("note");
  const [activityDate, setActivityDate] = useState(new Date().toISOString().slice(0, 10));
  const [activitySummary, setActivitySummary] = useState("");
  const canRead = Boolean(profile && hasPermission(profile, "hr.read"));
  const canManage = Boolean(profile && hasPermission(profile, "hr.manage"));
  const canRecord = Boolean(profile && hasPermission(profile, "hr.attendance.manage"));
  const canCompensate = Boolean(profile && hasPermission(profile, "hr.compensation.manage"));
  const branchNames = useMemo(() => new Map(branches.data.map((branch) => [branch.id, branch.name])), [branches.data]);
  const employeeNames = useMemo(() => new Map(workspace?.employees.map((item) => [item.id, item.fullName]) ?? []), [workspace]);
  const refresh = useCallback(async () => {
    if (!canRead) return;
    try { setWorkspace(await callAdministration<object, Workspace>("getHrWorkspace", { limit: pageSize, afterStaffId: pageCursors[pageIndex] ?? undefined })); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "HR records could not be loaded."); }
  }, [canRead, pageSize, pageCursors, pageIndex]);
  useEffect(() => { queueMicrotask(() => void refresh()); }, [refresh]);
  const run = async (operation: () => Promise<void>, success: string) => {
    setBusy(true); setError(null); setMessage(null);
    try { await operation(); setMessage(success); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The action could not be completed."); }
    finally { setBusy(false); }
  };
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run(async () => {
      await callAdministration("saveEmployee", { ...employee, employeeId: editingId ?? undefined, phone: employee.phone || null, email: employee.email || null, branchId: employee.branchId || null, userId: employee.userId || null, externalAttendanceId: employee.externalAttendanceId || null });
      setEditingId(null); setEmployee({ ...emptyEmployee });
    }, "Employee record saved.");
  };
  const saveSalary = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = salaryNaira.trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(value)) { setError("Enter a salary in naira with no more than two decimal places."); return; }
    const [naira, kobo = ""] = value.split(".");
    const minor = Number(naira) * 100 + Number(kobo.padEnd(2, "0"));
    if (!Number.isSafeInteger(minor)) { setError("Salary exceeds the supported amount."); return; }
    void run(async () => { await callAdministration("saveEmployeeCompensation", { employeeId: salaryEmployeeId, monthlySalaryMinor: minor, effectiveFrom: salaryDate, reason: salaryReason }); setSalaryNaira(""); setSalaryReason(""); }, "Salary version recorded. This does not run payroll or create a payment.");
  };
  const saveAttendance = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run(async () => { await callAdministration("recordAttendanceEvent", { employeeId: attendanceEmployeeId, kind: attendanceKind, occurredAt: new Date(attendanceTime).toISOString(), reason: attendanceReason, idempotencyKey: crypto.randomUUID() }); setAttendanceReason(""); }, "Attendance event recorded.");
  };
  const saveActivity = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run(async () => { await callAdministration("recordEmployeeActivity", { employeeId: activityEmployeeId, kind: activityKind, occurredOn: activityDate, summary: activitySummary, idempotencyKey: crypto.randomUUID() }); setActivitySummary(""); }, "Staff activity recorded.");
  };
  if (!canRead) return <p className="p-5">You do not have permission to view HR records.</p>;
  return <div className="page-stack">
    <PageHeader eyebrow="People" title="HR & attendance" description="Employees are independent of app logins. Keep staff, attendance and salary history here; connector IDs link future fingerprint scans." />
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {message && <p role="status" className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">{message}</p>}
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="rounded-xl border bg-white p-5"><UsersRound className="mb-2 size-5 text-[var(--brand)]"/><strong className="block text-2xl">{workspace?.employees.length ?? 0}</strong><span className="text-sm text-[var(--muted)]">Staff records loaded</span></div>
      <div className="rounded-xl border bg-white p-5"><Clock3 className="mb-2 size-5 text-[var(--brand)]"/><strong className="block text-2xl">{workspace?.attendance.length ?? 0}</strong><span className="text-sm text-[var(--muted)]">Recent attendance events</span></div>
      <div className="rounded-xl border bg-white p-5"><Banknote className="mb-2 size-5 text-[var(--brand)]"/><p className="text-sm">Salary terms are versioned and visible only to authorized administrators. Payroll and payslips are not yet automated.</p></div>
    </div>
    {canManage && <form onSubmit={save} className="rounded-xl border bg-white p-5 space-y-4"><h2 className="text-lg font-semibold">{editingId ? "Edit employee" : "Add employee"}</h2>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <label className="text-sm">Staff ID<input required disabled={Boolean(editingId)} value={employee.staffId} onChange={(e) => setEmployee({ ...employee, staffId: e.target.value })} className="input mt-1 w-full" /></label>
        <label className="text-sm">Full name<input required value={employee.fullName} onChange={(e) => setEmployee({ ...employee, fullName: e.target.value })} className="input mt-1 w-full" /></label>
        <label className="text-sm">Department<input required value={employee.department} onChange={(e) => setEmployee({ ...employee, department: e.target.value })} className="input mt-1 w-full" /></label>
        <label className="text-sm">Job title<input required value={employee.jobTitle} onChange={(e) => setEmployee({ ...employee, jobTitle: e.target.value })} className="input mt-1 w-full" /></label>
        <label className="text-sm">Phone<input value={employee.phone} onChange={(e) => setEmployee({ ...employee, phone: e.target.value })} className="input mt-1 w-full" /></label>
        <label className="text-sm">Email<input type="email" value={employee.email} onChange={(e) => setEmployee({ ...employee, email: e.target.value })} className="input mt-1 w-full" /></label>
        <label className="text-sm">Employment date<input type="date" required value={employee.employmentDate} onChange={(e) => setEmployee({ ...employee, employmentDate: e.target.value })} className="input mt-1 w-full" /></label>
        <label className="text-sm">Store / location<select value={employee.branchId} onChange={(e) => setEmployee({ ...employee, branchId: e.target.value })} className="input mt-1 w-full"><option value="">Unassigned</option>{branches.data.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
        <label className="text-sm">Employment status<select value={employee.status} onChange={(e) => setEmployee({ ...employee, status: e.target.value as Employee["status"] })} className="input mt-1 w-full"><option value="active">Active</option><option value="on_leave">On leave</option><option value="inactive">Inactive</option></select></label>
        <label className="text-sm">App user (optional)<select value={employee.userId} onChange={(e) => setEmployee({ ...employee, userId: e.target.value })} className="input mt-1 w-full"><option value="">No app access</option>{users.data.map((item) => <option key={item.id} value={item.id}>{item.displayName ?? item.email}</option>)}</select></label>
        <label className="text-sm">Fingerprint connector staff ID (optional)<input value={employee.externalAttendanceId} onChange={(e) => setEmployee({ ...employee, externalAttendanceId: e.target.value })} className="input mt-1 w-full" /><small className="block text-[var(--muted)]">Identifier only. Do not enter a fingerprint image or template.</small></label>
      </div><div className="flex gap-2"><Button disabled={busy} type="submit">Save employee</Button>{editingId && <Button type="button" variant="outline" onClick={() => { setEditingId(null); setEmployee({ ...emptyEmployee }); }}>Cancel edit</Button>}</div>
    </form>}
    <section className="rounded-xl border bg-white p-5"><div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Employees</h2><label className="text-sm">Rows per page <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPageIndex(0); setPageCursors([null]); }} className="input ml-2"><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label></div><div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead><tr className="border-b"><th className="p-2">Staff</th><th className="p-2">Role / department</th><th className="p-2">Store</th><th className="p-2">Status</th><th className="p-2">Attendance ID</th>{workspace?.canViewCompensation && <th className="p-2">Monthly salary</th>}<th className="p-2">Action</th></tr></thead><tbody>{workspace?.employees.map((item) => <tr key={item.id} className="border-b"><td className="p-2"><strong>{item.fullName}</strong><small className="block">{item.staffId}{item.userId ? " · App user" : " · No app login"}</small></td><td className="p-2">{item.jobTitle}<small className="block">{item.department}</small></td><td className="p-2">{branchNames.get(item.branchId ?? "") ?? "—"}</td><td className="p-2">{item.status.replaceAll("_", " ")}</td><td className="p-2">{item.externalAttendanceId ?? "—"}</td>{workspace.canViewCompensation && <td className="p-2">{item.salary ? money(item.salary.monthlySalaryMinor) : "Not set"}</td>}<td className="p-2">{canManage && <Button type="button" size="sm" variant="outline" onClick={() => { setEditingId(item.id); setEmployee({ staffId: item.staffId, fullName: item.fullName, phone: item.phone ?? "", email: item.email ?? "", department: item.department, jobTitle: item.jobTitle, branchId: item.branchId ?? "", employmentDate: item.employmentDate, status: item.status, userId: item.userId ?? "", externalAttendanceId: item.externalAttendanceId ?? "" }); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Edit</Button>}</td></tr>)}</tbody></table></div><div className="mt-3 flex items-center justify-between gap-3 text-sm"><span>Page {pageIndex + 1} · {workspace?.employees.length ?? 0} shown</span><div className="flex gap-2"><Button type="button" size="sm" variant="outline" disabled={pageIndex === 0} onClick={() => setPageIndex((value) => value - 1)}>Previous</Button><Button type="button" size="sm" variant="outline" disabled={!workspace?.nextCursor} onClick={() => { if (!workspace?.nextCursor) return; setPageCursors((value) => [...value.slice(0, pageIndex + 1), workspace.nextCursor]); setPageIndex((value) => value + 1); }}>Next</Button></div></div></section>
    <div className="grid gap-4 xl:grid-cols-2">
      {canRecord && <form onSubmit={saveAttendance} className="rounded-xl border bg-white p-5 space-y-3"><h2 className="text-lg font-semibold">Manual attendance correction</h2><p className="text-sm text-[var(--muted)]">Manual events require a reason and are kept as separate audit records.</p><label className="block text-sm">Employee<select required value={attendanceEmployeeId} onChange={(e) => setAttendanceEmployeeId(e.target.value)} className="input mt-1 w-full"><option value="">Select employee</option>{workspace?.employees.map((item) => <option key={item.id} value={item.id}>{item.staffId} · {item.fullName}</option>)}</select></label><label className="block text-sm">Event<select value={attendanceKind} onChange={(e) => setAttendanceKind(e.target.value as Attendance["kind"])} className="input mt-1 w-full"><option value="clock_in">Clock in</option><option value="clock_out">Clock out</option></select></label><label className="block text-sm">Date and time<input type="datetime-local" required value={attendanceTime} onChange={(e) => setAttendanceTime(e.target.value)} className="input mt-1 w-full" /></label><label className="block text-sm">Reason<input required minLength={3} value={attendanceReason} onChange={(e) => setAttendanceReason(e.target.value)} className="input mt-1 w-full" /></label><Button disabled={busy} type="submit">Record event</Button></form>}
      {canCompensate && <form onSubmit={saveSalary} className="rounded-xl border bg-white p-5 space-y-3"><h2 className="text-lg font-semibold">Salary terms</h2><p className="text-sm text-[var(--muted)]">Record a versioned monthly salary. This does not pay the employee.</p><label className="block text-sm">Employee<select required value={salaryEmployeeId} onChange={(e) => setSalaryEmployeeId(e.target.value)} className="input mt-1 w-full"><option value="">Select employee</option>{workspace?.employees.map((item) => <option key={item.id} value={item.id}>{item.staffId} · {item.fullName}</option>)}</select></label><label className="block text-sm">Monthly salary (₦)<input inputMode="decimal" required value={salaryNaira} onChange={(e) => setSalaryNaira(e.target.value)} placeholder="0.00" className="input mt-1 w-full" /></label><label className="block text-sm">Effective from<input type="date" required value={salaryDate} onChange={(e) => setSalaryDate(e.target.value)} className="input mt-1 w-full" /></label><label className="block text-sm">Reason<input required minLength={3} value={salaryReason} onChange={(e) => setSalaryReason(e.target.value)} className="input mt-1 w-full" /></label><Button disabled={busy} type="submit">Save salary version</Button></form>}
    </div>
    {canManage && <form onSubmit={saveActivity} className="rounded-xl border bg-white p-5 space-y-3"><h2 className="text-lg font-semibold">Staff activity</h2><p className="text-sm text-[var(--muted)]">Record leave, training and other HR events without changing attendance history.</p><div className="grid gap-3 md:grid-cols-3"><label className="text-sm">Employee<select required value={activityEmployeeId} onChange={(e) => setActivityEmployeeId(e.target.value)} className="input mt-1 w-full"><option value="">Select employee</option>{workspace?.employees.map((item) => <option key={item.id} value={item.id}>{item.staffId} · {item.fullName}</option>)}</select></label><label className="text-sm">Activity<select value={activityKind} onChange={(e) => setActivityKind(e.target.value as Activity["kind"])} className="input mt-1 w-full"><option value="leave">Leave</option><option value="training">Training</option><option value="performance">Performance</option><option value="incident">Incident</option><option value="note">Other note</option></select></label><label className="text-sm">Date<input required type="date" value={activityDate} onChange={(e) => setActivityDate(e.target.value)} className="input mt-1 w-full" /></label></div><label className="block text-sm">Details<textarea required minLength={3} maxLength={1000} value={activitySummary} onChange={(e) => setActivitySummary(e.target.value)} className="input mt-1 min-h-24 w-full" /></label><Button disabled={busy} type="submit">Record activity</Button></form>}
    <section className="rounded-xl border bg-white p-5"><h2 className="mb-3 text-lg font-semibold">Recent attendance</h2>{workspace?.attendance.length ? <div className="space-y-2">{workspace.attendance.map((item) => <div key={item.id} className="flex flex-wrap justify-between gap-2 rounded-lg border p-3 text-sm"><span><strong>{employeeNames.get(item.employeeId) ?? item.staffId}</strong> · {item.kind === "clock_in" ? "Clock in" : "Clock out"}</span><span>{displayTime(item.occurredAt)} · {item.source === "manual" ? "Manual" : "Fingerprint connector"}</span></div>)}</div> : <p className="text-sm text-[var(--muted)]">No attendance events yet.</p>}</section>
    <section className="rounded-xl border bg-white p-5"><h2 className="mb-3 text-lg font-semibold">Recent staff activities</h2>{workspace?.activities.length ? <div className="space-y-2">{workspace.activities.map((item) => <div key={item.id} className="rounded-lg border p-3 text-sm"><strong>{employeeNames.get(item.employeeId) ?? "Employee"}</strong> · {item.kind} · {item.occurredOn}<p className="mt-1">{item.summary}</p></div>)}</div> : <p className="text-sm text-[var(--muted)]">No staff activities recorded yet.</p>}</section>
  </div>;
}

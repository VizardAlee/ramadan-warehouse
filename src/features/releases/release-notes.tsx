"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AppDialog } from "@/components/ui/app-dialog";
import { useDialogFocus } from "@/components/ui/use-dialog-focus";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth/auth-context";
import { callAdministration } from "@/features/administration/api";
import { hasPermission } from "@/lib/permissions/roles";
import { releaseNotes } from "../../../functions/src/releases/catalog";
import type { PermissionId, UserProfile } from "@/types/domain";
export function ReleaseNotes() {
  const { profile } = useAuth();
  return profile ? <UserReleaseNotes key={`${profile.organizationId}:${profile.uid}`} profile={profile} /> : null;
}
function UserReleaseNotes({ profile }: { profile: UserProfile }) {
  const key = `${profile.organizationId}:${profile.uid}`;
  const [acknowledged, setAcknowledged] = useState<{ key: string; ids: string[] }>(), [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<string>();
  const ref = useDialogFocus<HTMLElement>(open, () => setOpen(false));
  useEffect(() => { if (!profile) return; let active = true; void (async () => { try { const value = await callAdministration<object, { acknowledgedReleaseIds: string[] }>("getMyAccessContext", { action: "release_notes" }); if (active && Array.isArray(value?.acknowledgedReleaseIds) && value.acknowledgedReleaseIds.every(id => typeof id === "string")) setAcknowledged({ key, ids: value.acknowledgedReleaseIds }); } catch { /* Keep past notes available; do not claim an unread/acknowledged state offline. */ } })(); return () => { active = false; }; }, [key, profile]);
  const unread = acknowledged?.key === key && !acknowledged.ids.includes(releaseNotes[0].id);
  async function dismiss() {
    if (busy) return; setBusy(true); setError(undefined);
    try { const value = await callAdministration<object, { releaseId: string; acknowledged: boolean }>("getMyAccessContext", { action: "acknowledge_release", releaseId: releaseNotes[0].id }); if (value.acknowledged && value.releaseId === releaseNotes[0].id) setAcknowledged(previous => ({ key, ids: [...new Set([...(previous?.key === key ? previous.ids : []), value.releaseId])] })); else throw new Error("Release acknowledgement was not confirmed."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Dismissal could not be saved. Retry when connected."); } finally { setBusy(false); }
  }
  return <section className="mb-4 space-y-2" aria-label="Release updates">{unread ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-3"><div><p className="font-semibold" role="status">New: {releaseNotes[0].title}</p><p className="text-xs text-[var(--muted)]">Read what changed. Dismissing is saved for your user account for this release.</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setOpen(true)}>View what’s new</Button><Button variant="secondary" disabled={busy} onClick={() => void dismiss()}>Dismiss release alert</Button></div></div> : <Button variant="ghost" onClick={() => setOpen(true)}>What’s new / past releases</Button>}{error && <p role="alert" className="text-sm">{error}</p>}{open && <AppDialog role="dialog" aria-modal="true" aria-label="What’s new"><section ref={ref} className="app-dialog-panel max-w-3xl space-y-5 rounded-2xl bg-white p-5"><h2 className="text-2xl font-semibold">What’s new</h2>{releaseNotes.map(release => <article key={release.id} className="space-y-3 border-t pt-4"><h3 className="text-lg font-semibold">{release.title}</h3><p className="text-xs text-[var(--muted)]">{release.date}</p><ul className="list-disc space-y-2 pl-5 text-sm">{release.changes.map(change => <li key={change}>{change}</li>)}</ul><div className="flex flex-wrap gap-2">{release.links.filter(link => profile && (!link.permissions.length || link.permissions.some(permission => hasPermission(profile, permission as PermissionId)))).map(link => <Link className="inline-flex min-h-11 items-center rounded-lg border px-3 text-sm font-semibold" key={link.href} href={link.href} onClick={() => setOpen(false)}>{link.label}</Link>)}</div></article>)}<Button variant="secondary" onClick={() => setOpen(false)}>Close release notes</Button></section></AppDialog>}</section>;
}

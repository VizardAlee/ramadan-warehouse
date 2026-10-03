"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { callAdministration } from "@/features/administration/api";
import { useAuth } from "@/features/auth/auth-context";
import { roleIdsForProfile } from "@/lib/permissions/roles";

interface ResetPreview {
  organizationId: string;
  legalName: string;
  code: string;
  usersToDeactivate: number;
  products: number;
  sales: number;
  inventoryEntries: number;
}
interface ResetResult {
  completed: boolean;
  archivedOrganizationId: string;
  activeOrganizationId: string;
  deactivatedUsers: number;
}
const pendingKey = (userId: string) => `abr-organization-reset-pending-key:${userId}`;

export default function ResetOrganizationPage() {
  const { profile, refreshAuthorization } = useAuth();
  const [preview, setPreview] = useState<ResetPreview | null>(null);
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ResetResult | null>(null);
  const [resumeKey, setResumeKey] = useState<string | null>(null);
  const isAdmin = profile && roleIdsForProfile(profile).includes("system_administrator");
  const userId = profile?.uid;

  useEffect(() => {
    if (!isAdmin || !userId) return;
    queueMicrotask(() => setResumeKey(window.localStorage.getItem(pendingKey(userId))));
    void callAdministration<Record<string, never>, ResetPreview>("previewOrganizationReset", {})
      .then(setPreview)
      .catch((error) => setMessage(error instanceof Error ? error.message : "The reset preview could not be loaded."));
  }, [isAdmin, userId]);

  async function startFresh() {
    if (!preview || !acknowledged || confirmation !== `RESET ${preview.code}` || reason.trim().length < 10) return;
    setPending(true);
    setMessage(null);
    const idempotencyKey = resumeKey ?? crypto.randomUUID();
    window.localStorage.setItem(pendingKey(profile!.uid), idempotencyKey);
    setResumeKey(idempotencyKey);
    try {
      const completed = await callAdministration<{
        confirmation: string; reason: string; idempotencyKey: string;
      }, ResetResult>("resetOrganizationData", { confirmation, reason, idempotencyKey });
      setResult(completed);
      window.localStorage.removeItem(pendingKey(profile!.uid));
      setResumeKey(null);
      await refreshAuthorization();
      setMessage("The previous business data is archived. Other user accounts are inactive and can be reactivated from Users after you create new store assignments.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The reset did not complete. Keep this page open and retry with the same confirmation; no archived data is deleted.");
    } finally {
      setPending(false);
    }
  }

  if (!isAdmin) return <div className="page-stack"><PageHeader title="Start fresh" description="Only system administrators can reset operational data." /></div>;
  return <div className="page-stack max-w-3xl">
    <PageHeader title="Start fresh" description="Begin a clean business state without deleting historical records." />
    <section className="rounded-xl border bg-white p-5 space-y-4">
      <h2 className="font-semibold">What happens</h2>
      <p className="text-sm leading-6 text-[var(--muted)]">The current organization becomes a read-only archive, including its sales, inventory, accounting and audit history. A new active organization keeps the same business identity but starts with no products, stock, stores, customers, suppliers, sales or balances. Other app users are deactivated—not deleted—and can be reactivated by an administrator after new store assignments are set. Your administrator account remains active.</p>
      <p className="text-sm leading-6 text-[var(--muted)]">Existing offline POS transactions cannot be carried into the new organization. Sync and reconcile all tills first. Reopen the app after completion to load the fresh organization.</p>
      {preview && <div className="rounded-lg border bg-slate-50 p-4 text-sm">
        <p className="font-medium">{preview.legalName} ({preview.code})</p>
        <p className="mt-2">Current records: {preview.products} products, {preview.sales} sales, {preview.inventoryEntries} stock-ledger entries. {preview.usersToDeactivate} other user account(s) will become inactive.</p>
      </div>}
      {resumeKey && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">A reset was started in this browser. Use the same confirmation below to resume it; do not start a second reset.</p>}
      {result && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">Fresh organization ready. Archived organization: {result.archivedOrganizationId}. New organization: {result.activeOrganizationId}.</p>}
      {message && <p role="status" className="rounded-lg border p-3 text-sm">{message}</p>}
      {!result && <div className="space-y-4">
        <label className="block text-sm font-medium">Reason for reset
          <textarea className="mt-1 block w-full rounded-lg border p-3" rows={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why is the organization starting fresh? This is recorded in the audit trail." />
        </label>
        <label className="block text-sm font-medium">Type {preview ? `RESET ${preview.code}` : "the confirmation phrase shown above"}
          <input className="mt-1 block w-full rounded-lg border p-3" autoComplete="off" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
        </label>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />I have reconciled offline sales and understand that the old business records will be archived and other users deactivated.</label>
        <Button type="button" disabled={!preview || pending || reason.trim().length < 10 || confirmation !== `RESET ${preview.code}` || !acknowledged} onClick={() => void startFresh()}>{pending ? "Starting fresh…" : resumeKey ? "Resume reset" : "Archive data and start fresh"}</Button>
        <p className="text-xs text-[var(--muted)]">For security, sign out and back in if your session is older than 15 minutes. This operation may take several minutes.</p>
      </div>}
    </section>
  </div>;
}

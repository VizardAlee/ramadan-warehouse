"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import { formatNaira, nairaToKobo } from "@/features/inventory/format";

export interface TaxRule {
  id: string; taxType?: string; scopeKey?: string; version?: string; title?: string;
  effectiveFrom?: string; effectiveTo?: string; status?: string; source?: string;
  sourceReference?: string; applicability?: string; exemptions?: string; basis?: string;
  rateBasisPoints?: number; sourceVerified?: boolean;
}
const field = "mt-1 w-full rounded-lg border bg-white p-2.5";
const blank = { taxType: "VAT", scopeKey: "standard", version: "", title: "", effectiveFrom: "", effectiveTo: "", calculation: "flat_rate", basis: "taxable_supplies", rate: "", applicability: "", exemptions: "", source: "", sourceReference: "", reason: "" };
export function TaxRuleWorkspace({ rules, canManage, ownerKey, onSaved }: { rules: TaxRule[]; canManage: boolean; ownerKey: string; onSaved: () => void }) {
  const [draft, setDraft] = useState(blank), [expanded, setExpanded] = useState("");
  const [reason, setReason] = useState(""), [verified, setVerified] = useState(false);
  const [date, setDate] = useState(""), [base, setBase] = useState("");
  const [preview, setPreview] = useState<{ taxMinor: number; baseMinor: number; ruleVersion: string; basis: string } | null>(null);
  const [pending, setPending] = useState<Record<string, unknown> | null>(null);
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const storageKey = `abr-pending-tax-rule:${ownerKey}`;
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { const saved = sessionStorage.getItem(storageKey); setPending(saved ? JSON.parse(saved) : null); setReady(true); }
      catch { setError("Saved tax instructions could not be read. Check the rule register before submitting another version."); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [storageKey]);
  async function mutate(instructions?: Record<string, unknown>) {
    if (!navigator.onLine) { setError("Reconnect before saving or reviewing tax rules."); return; }
    const retry = pending; setBusy(true); setError(""); setMessage("");
    try {
      const input = retry ?? { ...instructions, idempotencyKey: crypto.randomUUID() };
      sessionStorage.setItem(storageKey, JSON.stringify(input)); setPending(input);
      const result = await callAdministration<object, { status: string }>("taxRuleAdministration", input);
      sessionStorage.removeItem(storageKey); setPending(null); setDraft(blank); setReason(""); setVerified(false);
      setMessage(`Tax rule ${result.status}. Historical transactions have not been recalculated.`); onSaved();
    } catch (cause) {
      const diagnostic = cause as { diagnosticCode?: string; code?: string };
      if (!retry && ["functions/invalid-argument", "functions/permission-denied", "functions/failed-precondition", "functions/not-found"].includes(diagnostic.diagnosticCode ?? diagnostic.code ?? "")) { sessionStorage.removeItem(storageKey); setPending(null); }
      setError(cause instanceof Error ? cause.message : "The result could not be confirmed. Retry the saved tax instructions.");
    } finally { setBusy(false); }
  }
  async function calculate(ruleId: string) {
    setBusy(true); setError(""); setPreview(null);
    try {
      const result = await callAdministration<object, { taxMinor: number; baseMinor: number; ruleVersion: string; basis: string }>("taxRuleAdministration", { action: "preview", ruleId, transactionDate: date, baseMinor: nairaToKobo(Number(base)) });
      setPreview(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The calculation could not be completed."); }
    finally { setBusy(false); }
  }
  const locked = busy || !ready || Boolean(pending);
  return <section className="space-y-4 rounded-xl border bg-white p-5" aria-label="Tax rule configuration">
    <header><h2 className="text-xl font-semibold">Tax rule register & review</h2><p className="text-sm text-[var(--muted)]">Rules are immutable versions. Approval enables reviewed-base previews, not automatic POS repricing, tax filing or retrospective ledger changes.</p></header>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
    {message && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-emerald-800">{message}</p>}
    {pending && <div className="rounded-lg bg-amber-50 p-3"><p>Tax instructions have an unconfirmed result. Retry the exact saved request before starting another.</p><Button disabled={busy || !ready || !canManage} onClick={() => void mutate()}>Retry saved tax instructions</Button></div>}
    {rules.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-3">Tax / scope</th><th className="p-3">Version</th><th className="p-3">Effective period</th><th className="p-3">Rate</th><th className="p-3">Status</th><th className="p-3">Details</th></tr></thead><tbody>{rules.map(rule => <TaxRuleRow key={rule.id} rule={rule} disabled={busy} expanded={expanded === rule.id} onExpand={() => { setExpanded(expanded === rule.id ? "" : rule.id); setReason(""); setVerified(false); setPreview(null); setDate(""); setBase(""); }}>
      <div className="space-y-3"><p><strong>Calculation basis:</strong> {rule.basis?.replaceAll("_", " ") ?? "Legacy rule — review required"}</p><p><strong>Applies to:</strong> {rule.applicability ?? "Not recorded"}</p><p><strong>Exemptions / thresholds:</strong> {rule.exemptions ?? "Not recorded"}</p><p><strong>Statutory reference:</strong> {rule.sourceReference ?? "Not recorded"}</p>
        {rule.source && /^https:\/\//.test(rule.source) && <a href={rule.source} target="_blank" rel="noopener noreferrer" className="break-all text-[var(--brand)] underline">Read statutory source</a>}
        {canManage && rule.status === "draft" && <fieldset disabled={locked} className="grid gap-3 sm:grid-cols-2"><label>Review reason<textarea className={field} value={reason} onChange={event => setReason(event.target.value)} /></label><label className="flex items-start gap-2"><input className="mt-1" type="checkbox" checked={verified} onChange={event => setVerified(event.target.checked)} />I verified the statutory source, effective dates, rate, company/product applicability, exemptions and calculation basis.</label><div className="flex flex-wrap gap-2 sm:col-span-2"><Button disabled={!verified || reason.trim().length < 10} onClick={() => void mutate({ action: "review", ruleId: rule.id, decision: "approved", sourceVerified: verified, reason })}>Approve reviewed rule</Button><Button variant="secondary" disabled={reason.trim().length < 10} onClick={() => void mutate({ action: "review", ruleId: rule.id, decision: "rejected", sourceVerified: verified, reason })}>Reject rule</Button></div></fieldset>}
        {rule.status === "approved" && rule.sourceVerified && <fieldset disabled={busy || !ready} className="grid gap-3 sm:grid-cols-2"><legend className="font-semibold">Preview only — no liability or payment is posted</legend><label>Transaction date<input type="date" className={field} value={date} onChange={event => { setDate(event.target.value); setPreview(null); }} /></label><label>Accountant-reviewed tax base (₦)<input type="number" min="0" step="0.01" className={field} value={base} onChange={event => { setBase(event.target.value); setPreview(null); }} /></label><p className="text-sm sm:col-span-2">Confirm exemptions and tax adjustments first. Taxable/assessable profit is not necessarily accounting profit; do not substitute turnover or a sales total.</p><Button disabled={!date || base === "" || !Number.isFinite(Number(base)) || Number(base) < 0} onClick={() => void calculate(rule.id)}>Preview tax calculation</Button>{preview && <p role="status">Version {preview.ruleVersion}: {formatNaira(preview.taxMinor)} on {formatNaira(preview.baseMinor)} ({preview.basis.replaceAll("_", " ")}). Not posted.</p>}</fieldset>}
      </div>
    </TaxRuleRow>)}</tbody></table></div> : <p className="text-sm text-[var(--muted)]">No tax rules on this page. Propose a reviewed version; no statutory percentage is activated automatically.</p>}
    {canManage && <details className="rounded-lg border p-4"><summary className="cursor-pointer font-semibold">Propose a new tax rule version</summary><p className="my-3 text-sm">Use an authoritative source and explicit bounded dates. A draft does not calculate taxes. Use a new version for corrections; approved periods for the same tax/scope cannot overlap. Standard VAT coverage uses scope key “standard”.</p><fieldset disabled={locked} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <label>Tax type<select className={field} value={draft.taxType} onChange={event => setDraft({ ...draft, taxType: event.target.value })}>{["VAT", "CIT", "DEVELOPMENT_LEVY", "WHT", "STAMP_DUTY", "OTHER"].map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Scope key<input className={field} value={draft.scopeKey} onChange={event => setDraft({ ...draft, scopeKey: event.target.value })} placeholder="standard" /></label>
      <label>Version<input className={field} value={draft.version} onChange={event => setDraft({ ...draft, version: event.target.value })} /></label>
      <label>Rule title<input className={field} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
      <label>Effective from<input type="date" className={field} value={draft.effectiveFrom} onChange={event => setDraft({ ...draft, effectiveFrom: event.target.value })} /></label>
      <label>Effective to<input type="date" className={field} value={draft.effectiveTo} onChange={event => setDraft({ ...draft, effectiveTo: event.target.value })} /></label>
      <label>Calculation basis<select className={field} value={draft.basis} onChange={event => setDraft({ ...draft, basis: event.target.value })}>{["taxable_supplies", "taxable_profit", "assessable_profit", "withholding_base", "instrument_value", "reviewed_base"].map(value => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
      <label>Rate (%)<input type="number" min="0" max="100" step="0.01" className={field} value={draft.rate} onChange={event => setDraft({ ...draft, rate: event.target.value })} /></label>
      <label>Statutory source URL<input type="url" className={field} value={draft.source} onChange={event => setDraft({ ...draft, source: event.target.value })} placeholder="https://…" /></label>
      <label>Source section / reference<input className={field} value={draft.sourceReference} onChange={event => setDraft({ ...draft, sourceReference: event.target.value })} /></label>
      <label>Applicability<textarea className={field} value={draft.applicability} onChange={event => setDraft({ ...draft, applicability: event.target.value })} /></label>
      <label>Exemptions / thresholds<textarea className={field} value={draft.exemptions} onChange={event => setDraft({ ...draft, exemptions: event.target.value })} /></label>
      <label className="sm:col-span-2">Proposal reason<textarea className={field} value={draft.reason} onChange={event => setDraft({ ...draft, reason: event.target.value })} /></label>
      <div className="sm:col-span-2"><Button disabled={!/^\d+(\.\d{1,2})?$/.test(draft.rate) || Number(draft.rate) > 100 || draft.reason.trim().length < 10 || !draft.version || !draft.effectiveFrom || !draft.effectiveTo} onClick={() => {
        const { rate, reason: proposalReason, ...definition } = draft;
        void mutate({ action: "propose", definition: { ...definition, rateBasisPoints: Math.round(Number(rate) * 100) }, reason: proposalReason });
      }}>Save draft rule</Button></div>
    </fieldset></details>}
  </section>;
}
function TaxRuleRow({ rule, disabled, expanded, onExpand, children }: { rule: TaxRule; disabled: boolean; expanded: boolean; onExpand: () => void; children: React.ReactNode }) {
  return <><tr className="border-b"><td className="p-3">{rule.taxType}<span className="block text-xs">{rule.scopeKey ?? "Legacy scope"}</span></td><td className="p-3">{rule.version}</td><td className="p-3 whitespace-nowrap">{rule.effectiveFrom} – {rule.effectiveTo ?? "Review required"}</td><td className="p-3">{rule.rateBasisPoints === undefined ? "Not recorded" : `${rule.rateBasisPoints / 100}%`}</td><td className="p-3 capitalize">{rule.status}</td><td className="p-3"><button disabled={disabled} className="text-[var(--brand)] underline" onClick={onExpand} aria-expanded={expanded}>{expanded ? "Hide rule" : "View rule"}</button></td></tr>{expanded && <tr className="border-b bg-slate-50"><td colSpan={6} className="p-4">{children}</td></tr>}</>;
}

"use client";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import { FinancialMessage, FinancialText, FinancialValue } from "@/features/finance/financial-privacy";
import { formatNaira } from "@/features/inventory/format";
type Review = {
  customerId: string; customerNumber: string; name: string; currentBranchName: string; fingerprint: string;
  issues: string[]; blockers: string[]; allowedTargetBranchIds: string[]; branches: Array<{ id: string; name: string }>;
  outstandingMinor: number | null; advanceMinor: number; trackedUnpaidMinor: number;
  activity: Array<{ branchId: string; branchName: string; recordCount: number }>;
  openInvoices: Array<{ id: string; number: string; branchId: string | null; outstandingMinor: number | null }>;
  advanceBalances: Record<string, number>; arrangements: Array<{ id: string; name: string; outstandingMinor: number | null }>;
};
const field = "mt-1 w-full rounded-lg border p-2";
function Assignment({ record, onSaved }: { record: Review; onSaved: () => void }) {
  const [branchId, setBranchId] = useState(""), [reason, setReason] = useState(""), [number, setNumber] = useState(""), [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [uncertain, setUncertain] = useState(false);
  const pending = useRef<Record<string, unknown> | null>(null);
  async function save() {
    pending.current ??= { action: "ownership_assign", customerId: record.customerId, branchId, expectedFingerprint: record.fingerprint, confirmedCustomerNumber: number, acknowledgeHistoryUnchanged: acknowledged, reason, idempotencyKey: crypto.randomUUID() };
    setBusy(true); setError("");
    try { await callAdministration("getCustomerHistory", pending.current); pending.current = null; setUncertain(false); onSaved(); }
    catch (cause) {
      const code = (cause as { diagnosticCode?: string; code?: string }).diagnosticCode ?? (cause as { code?: string }).code ?? "";
      const definitive = ["CUSTOMER_OWNERSHIP_STALE", "CUSTOMER_OWNERSHIP_REVIEW_REQUIRED", "CUSTOMER_OWNERSHIP_ADMIN_REQUIRED", "ALL_LOCATIONS_REQUIRED", "functions/resource-exhausted", "functions/invalid-argument", "functions/failed-precondition", "functions/permission-denied", "functions/not-found", "functions/already-exists"].includes(code);
      if (definitive) pending.current = null;
      setUncertain(!definitive); setError(cause instanceof Error ? cause.message : "Assignment could not be confirmed.");
    } finally { setBusy(false); }
  }
  return <details className="rounded-lg border p-3"><summary className="cursor-pointer font-medium"><FinancialText>{record.name} · {record.customerNumber} · {record.currentBranchName}</FinancialText></summary>
    <p className="mt-2 text-sm"><FinancialText>{record.issues.length ? record.issues.map(issue => issue.replaceAll("_", " ")).join(", ") : "No ownership conflict detected"}</FinancialText></p>
    <p className="text-sm">Customer balance: <FinancialValue>{record.outstandingMinor === null ? "Needs review" : formatNaira(record.outstandingMinor)}</FinancialValue> · Unpaid tracked invoices: <FinancialValue>{formatNaira(record.trackedUnpaidMinor)}</FinancialValue> · Advances: <FinancialValue>{formatNaira(record.advanceMinor)}</FinancialValue></p>
    {record.activity.map(item => <p className="text-sm" key={item.branchId}><FinancialText>{item.branchName} · {item.recordCount} recorded activities</FinancialText></p>)}
    {record.openInvoices.map(invoice => <p className="text-sm" key={invoice.id}>Open invoice: <FinancialText>{invoice.number}</FinancialText> · <FinancialText>{record.branches.find(branch => branch.id === invoice.branchId)?.name ?? "Unattributed branch"}</FinancialText> · <FinancialValue>{invoice.outstandingMinor === null ? "Legacy balance requires review" : formatNaira(invoice.outstandingMinor)}</FinancialValue></p>)}
    {Object.entries(record.advanceBalances).map(([account, amount]) => <p className="text-sm" key={account}>Advance account <FinancialText>{account}</FinancialText>: <FinancialValue>{formatNaira(amount)}</FinancialValue></p>)}
    {record.arrangements.map(account => <p className="text-sm" key={account.id}>Arrangement <FinancialText>{account.name}</FinancialText>: <FinancialValue>{account.outstandingMinor === null ? "Needs review" : formatNaira(account.outstandingMinor)}</FinancialValue></p>)}
    {record.blockers.length ? <p className="mt-3 text-sm">Assignment is blocked pending accounting review of the history and balances shown above. No account splitting or posted-history rewrite is performed.</p> : <fieldset disabled={busy || uncertain} className="mt-3 space-y-3">
      <label className="block text-sm">Reviewed owning branch<select className={field} value={branchId} onChange={event => setBranchId(event.target.value)}><option value="">Select after review</option>{record.branches.filter(branch => record.allowedTargetBranchIds.includes(branch.id)).map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
      <label className="block text-sm">Review reason<textarea className={field} value={reason} onChange={event => setReason(event.target.value)} minLength={5} maxLength={1000} /></label>
      <label className="block text-sm">Confirm customer number<input className={field} value={number} onChange={event => setNumber(event.target.value)} autoComplete="off" /></label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />I have reviewed the balances. This changes future customer ownership; existing invoices, payments, balances and branch history remain unchanged.</label>
    </fieldset>}
    {error && <p role="alert" className="mt-2 text-sm text-red-700"><FinancialMessage>{error}</FinancialMessage></p>}
    {(!record.blockers.length || uncertain) && <Button className="mt-3" disabled={busy || (!uncertain && (!branchId || reason.trim().length < 5 || number !== record.customerNumber || !acknowledged))} onClick={() => void save()}>{uncertain ? "Retry same assignment" : "Save reviewed ownership"}</Button>}
  </details>;
}
export function CustomerOwnershipReview({ allLocations }: { allLocations: boolean }) {
  const [rows, setRows] = useState<Review[]>([]), [cursor, setCursor] = useState<string | null>(null), [started, setStarted] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function load(next?: string) {
    setBusy(true); setError("");
    try { const result = await callAdministration<object, { rows: Review[]; nextCursor: string | null }>("getCustomerHistory", { action: "ownership_list", cursor: next, limit: 10 }); setRows(result.rows); setCursor(result.nextCursor); setStarted(true); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Ownership reviews could not be loaded."); } finally { setBusy(false); }
  }
  return <section className="space-y-3 rounded-xl border bg-white p-4"><h2 className="text-xl font-semibold">Customer branch ownership review</h2><p className="text-sm">System Administrators review recorded activity and balances before assigning an owner. Customer assignments are audited; posted history stays unchanged.</p>{!allLocations ? <p className="text-sm">Select All locations to review company-wide ownership evidence.</p> : <><Button variant="secondary" disabled={busy} onClick={() => void load()}>Start / refresh review</Button>{started && rows.map(row => <Assignment key={row.customerId + row.fingerprint} record={row} onSaved={() => void load()} />)}{started && !rows.length && <p>No customers in this page.</p>}{cursor && <Button variant="secondary" disabled={busy} onClick={() => void load(cursor)}>Next review page</Button>}</>}{error && <p role="alert"><FinancialMessage>{error}</FinancialMessage></p>}</section>;
}

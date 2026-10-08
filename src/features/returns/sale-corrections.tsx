"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CursorTablePagination } from "@/components/ui/table-pagination";
import { callAdministration } from "@/features/administration/api";
import { formatNaira, nairaToKobo } from "@/features/inventory/format";
type Source = { sale: { saleNumber: string; receiptNumber: string; customerId: string | null }; items: Array<{ productId: string; productName: string; soldQuantity: number; unitPriceMinor: number }> };
type Proposal = { customerId: string | null; customerName?: string | null; discountAmountMinor: number; details: string; lines: Array<{ productId: string; productName?: string; quantity: number; unitPriceMinor: number }> };
type Correction = { id: string; correctionNumber: string; saleNumber: string; reason: string; status: string; reviewReason?: string; replacementSaleNumber?: string; returnNumbers?: string[]; originalValues: { customerName: string | null; grossAmountMinor: number; lines: Array<{ productName: string; quantity: number; unitPriceMinor: number }> }; proposedValues: Proposal };
function useAction(onComplete: () => void) {
  const pending = useRef<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [error, setError] = useState("");
  async function submit(payload: Record<string, unknown>) {
    pending.current ??= { ...payload, idempotencyKey: crypto.randomUUID() };
    setBusy(true); setError("");
    try { await callAdministration("salesCorrections", pending.current); pending.current = null; setUncertain(false); onComplete(); }
    catch (cause) {
      const code = (cause as { diagnosticCode?: string; code?: string })?.diagnosticCode ?? (cause as { code?: string })?.code;
      const definitive = ["SALE_CORRECTION_ACTION_REQUIRED", "functions/invalid-argument", "functions/permission-denied", "functions/failed-precondition", "functions/already-exists", "functions/not-found"].includes(code ?? "");
      if (definitive) pending.current = null;
      setUncertain(!definitive); setError(cause instanceof Error ? cause.message : "The correction could not be confirmed.");
    } finally { setBusy(false); }
  }
  return { submit, busy, uncertain, error };
}
const field = "mt-1 w-full rounded-lg border p-2";
function CorrectionRequest({ branchId, source, onComplete }: { branchId: string; source: Source; onComplete: () => void }) {
  const [reason, setReason] = useState(""), [details, setDetails] = useState(""), [customerId, setCustomerId] = useState(source.sale.customerId ?? ""), [discount, setDiscount] = useState("0");
  const [lines, setLines] = useState(source.items.map(item => ({ productId: item.productId, name: item.productName, quantity: String(item.soldQuantity), price: String(item.unitPriceMinor / 100) })));
  const [choices, setChoices] = useState<{ products: Array<{ id: string; name: string; unitPriceMinor: number }>; customers: Array<{ id: string; name: string }> }>({ products: [], customers: [] }), [choiceError, setChoiceError] = useState("");
  const action = useAction(onComplete);
  async function loadChoices() { try { setChoices(await callAdministration("getPosWorkspace", { branchId })); setChoiceError(""); } catch (cause) { setChoiceError(cause instanceof Error ? cause.message : "Choices could not be loaded."); } }
  let proposedValues: Proposal | null = null;
  try {
    const amounts = lines.map(line => ({ productId: line.productId, quantity: Number(line.quantity), unitPriceMinor: nairaToKobo(Number(line.price)) })), discountAmountMinor = nairaToKobo(Number(discount));
    if (amounts.length && amounts.every(line => Number.isSafeInteger(line.quantity) && line.quantity > 0 && line.unitPriceMinor > 0) && new Set(amounts.map(line => line.productId)).size === amounts.length && discountAmountMinor >= 0 && discountAmountMinor < amounts.reduce((sum, line) => sum + line.quantity * line.unitPriceMinor, 0)) proposedValues = { customerId: customerId || null, discountAmountMinor, details, lines: amounts };
  } catch { /* Invalid decimals remain editable. */ }
  return <details className="rounded-xl border p-4"><summary className="cursor-pointer font-semibold">Request correction to {source.sale.saleNumber}</summary>
    <p className="mt-2 text-sm">This proposes a full return/cancellation and reissue. Approval changes no stock or money. Collected goods must genuinely be returned and inspected; never record fictitious returns for paperwork-only changes.</p>
    <fieldset disabled={action.busy || action.uncertain} className="mt-3 space-y-3"><Button variant="secondary" onClick={() => void loadChoices()}>Load product and customer choices</Button>{choiceError && <p role="alert">{choiceError}</p>}
      <label className="block text-sm">Proposed customer<select className={field} value={customerId} onChange={event => setCustomerId(event.target.value)}><option value="">Walk-in customer</option>{customerId && !choices.customers.some(customer => customer.id === customerId) && <option value={customerId}>Original named customer</option>}{choices.customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
      {lines.map((line, index) => <div key={index} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[2fr_1fr_1fr_auto]">
        <label className="text-sm">Product<select className={field} value={line.productId} onChange={event => setLines(value => value.map((item, position) => position === index ? { ...item, productId: event.target.value, name: choices.products.find(product => product.id === event.target.value)?.name ?? item.name } : item))}>{!choices.products.some(product => product.id === line.productId) && <option value={line.productId}>{line.name}</option>}{choices.products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
        <label className="text-sm">Quantity<input aria-label={`Proposed quantity ${index + 1}`} className={field} type="number" min="1" step="1" value={line.quantity} onChange={event => setLines(value => value.map((item, position) => position === index ? { ...item, quantity: event.target.value } : item))} /></label>
        <label className="text-sm">Unit price before VAT (₦)<input aria-label={`Proposed price ${index + 1}`} className={field} type="number" min="0.01" step="0.01" value={line.price} onChange={event => setLines(value => value.map((item, position) => position === index ? { ...item, price: event.target.value } : item))} /></label><Button variant="secondary" onClick={() => setLines(value => value.filter((_, position) => position !== index))}>Remove</Button>
      </div>)}
      <Button variant="secondary" disabled={!choices.products.length} onClick={() => { const product = choices.products.find(product => !lines.some(line => line.productId === product.id)); if (product) setLines(value => [...value, { productId: product.id, name: product.name, quantity: "1", price: String(product.unitPriceMinor / 100) }]); }}>Add proposed product</Button>
      <label className="block text-sm">Proposed discount (₦)<input className={field} type="number" min="0" step="0.01" value={discount} onChange={event => setDiscount(event.target.value)} /></label>
      <label className="block text-sm">Why is a correction needed?<textarea className={field} value={reason} onChange={event => setReason(event.target.value)} /></label>
      <label className="block text-sm">Proposed changes and settlement instructions<textarea className={field} value={details} onChange={event => setDetails(event.target.value)} /></label>
    </fieldset>{action.error && <p role="alert" className="mt-3 text-sm text-red-700">{action.error}{action.uncertain && " Confirmation was not received. Retry the same request."}</p>}
    <Button className="mt-3" disabled={action.busy || (!action.uncertain && (!proposedValues || reason.trim().length < 5 || details.trim().length < 5))} onClick={() => void action.submit({ action: "request", branchId, receiptNumber: source.sale.receiptNumber, reason, proposedValues })}>{action.uncertain ? "Retry same request" : "Submit correction request"}</Button>
  </details>;
}
function CorrectionReview({ record, canApprove, onComplete }: { record: Correction; canApprove: boolean; onComplete: () => void }) {
  const [reason, setReason] = useState(""), [returnNumbers, setReturnNumbers] = useState(""), [replacementNumber, setReplacementNumber] = useState("");
  const action = useAction(onComplete), ready = reason.trim().length >= 5;
  return <details className="rounded-xl border p-4"><summary className="cursor-pointer font-medium">{record.correctionNumber} · {record.saleNumber} · {record.status === "approved" ? "Approved — processing required" : record.status}</summary><p className="mt-2 text-sm">{record.reason}</p>
    <div className="mt-3 grid gap-4 sm:grid-cols-2"><div><h3 className="font-medium">Original order</h3><p>{record.originalValues.customerName ?? "Walk-in customer"} · {formatNaira(record.originalValues.grossAmountMinor)}</p>{record.originalValues.lines.map((line, index) => <p key={index} className="text-sm">{line.productName} · {line.quantity} × {formatNaira(line.unitPriceMinor)}</p>)}</div><div><h3 className="font-medium">Proposed replacement</h3><p>{record.proposedValues.customerName ?? (record.proposedValues.customerId ? "Named customer" : "Walk-in customer")}</p>{record.proposedValues.lines.map((line, index) => <p key={index} className="text-sm">{line.productName ?? `Product ${index + 1}`} · {line.quantity} × {formatNaira(line.unitPriceMinor)}</p>)}<p className="text-sm">Discount: {formatNaira(record.proposedValues.discountAmountMinor)}</p><p className="mt-2 text-sm">{record.proposedValues.details}</p></div></div>
    {record.reviewReason && <p className="mt-2 text-sm">Review: {record.reviewReason}</p>}{record.replacementSaleNumber && <p className="mt-2 text-sm">Verified replacement: {record.replacementSaleNumber} · {record.returnNumbers?.join(", ")}</p>}
    {canApprove && ["submitted", "approved"].includes(record.status) && <><fieldset disabled={action.busy || action.uncertain} className="mt-3 space-y-3">{record.status === "approved" && <><p className="text-sm">Process the actual returns/cancellations here, then the replacement through POS. Enter their numbers to verify completion. This action itself moves no money or stock.</p><label className="block text-sm">Posted return/cancellation numbers (comma separated)<input className={field} value={returnNumbers} onChange={event => setReturnNumbers(event.target.value)} placeholder="RTN-2026-000001" /></label><label className="block text-sm">Replacement sale number<input className={field} value={replacementNumber} onChange={event => setReplacementNumber(event.target.value)} placeholder="SAL-IRB-2026-000001" /></label></>}
      <label className="block text-sm">Review / completion reason<textarea className={field} value={reason} onChange={event => setReason(event.target.value)} /></label></fieldset>{action.error && <p role="alert" className="mt-2 text-sm text-red-700">{action.error}{action.uncertain && " Retry the same request; its outcome is not confirmed."}</p>}
      <div className="mt-3 flex flex-wrap gap-2">{action.uncertain ? <Button disabled={action.busy} onClick={() => void action.submit({})}>Retry same request</Button> : record.status === "submitted" ? <>{["approved", "rejected"].map(decision => <Button key={decision} variant={decision === "rejected" ? "secondary" : "primary"} disabled={action.busy || !ready} onClick={() => void action.submit({ action: "review", correctionId: record.id, decision, reason })}>{decision === "approved" ? "Approve correction plan" : "Reject request"}</Button>)}</> : <Button disabled={action.busy || !ready || !returnNumbers.trim() || !replacementNumber.trim()} onClick={() => void action.submit({ action: "complete", correctionId: record.id, returnNumbers: returnNumbers.split(",").map(value => value.trim()).filter(Boolean), replacementNumber: replacementNumber.trim(), reason })}>Verify linked transactions and complete</Button>}</div>
    </>}
  </details>;
}
export function SaleCorrections({ branchId, source, canCreate, canApprove }: { branchId: string; source: Source | null; canCreate: boolean; canApprove: boolean }) {
  const [status, setStatus] = useState("submitted"), [limit, setLimit] = useState(25), [pages, setPages] = useState<Array<string | null>>([null]), [pageBranch, setPageBranch] = useState(branchId), [version, setVersion] = useState(0);
  const [result, setResult] = useState<{ scope: string; records: Correction[]; nextCursor: string | null }>({ scope: "", records: [], nextCursor: null }), [error, setError] = useState(""), [loading, setLoading] = useState(false);
  const scope = `${branchId}:${status}:${limit}`, scopedPages = pageBranch === branchId ? pages : [null], cursor = scopedPages.at(-1);
  useEffect(() => { let active = true; const timer = window.setTimeout(() => { if (!branchId) return; setLoading(true); setError(""); void callAdministration<object, { records: Correction[]; nextCursor: string | null }>("salesCorrections", { action: "list", branchId, status, limit, cursor: cursor || undefined }).then(data => { if (active) setResult({ scope, ...data }); }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Corrections could not be loaded."); }).finally(() => { if (active) setLoading(false); }); }, 0); return () => { active = false; window.clearTimeout(timer); }; }, [branchId, status, limit, cursor, scope, version]);
  const reload = () => setVersion(value => value + 1), records = result.scope === scope ? result.records : [];
  return <section className="space-y-3 rounded-2xl border bg-white p-4 sm:p-5"><h2 className="text-xl font-semibold">Posted-order correction requests</h2><p className="text-sm text-[var(--muted)]">Original invoices stay unchanged. This supports a controlled full return/cancellation and replacement, with accounting and stock evidence linked. Approval is not completion.</p>
    {source && canCreate ? <CorrectionRequest key={source.sale.saleNumber} branchId={branchId} source={source} onComplete={reload} /> : <p className="text-sm">Load the original receipt above to request a correction.</p>}
    <label className="block text-sm">Correction status<select className="ml-2 rounded-lg border p-2" value={status} onChange={event => { setStatus(event.target.value); setPages([null]); }}>{["submitted", "approved", "rejected", "completed"].map(value => <option key={value} value={value}>{value === "approved" ? "Approved — awaiting processing" : value}</option>)}</select></label>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}{loading && <p className="text-sm">Loading corrections…</p>}{records.map(record => <CorrectionReview key={record.id} record={record} canApprove={canApprove} onComplete={reload} />)}{!loading && !error && !records.length && <p className="text-sm text-[var(--muted)]">No corrections in this view.</p>}
    <CursorTablePagination page={scopedPages.length} pageSize={limit} rowCount={records.length} hasNextPage={result.scope === scope && Boolean(result.nextCursor)} loading={loading} onPrevious={() => setPages(scopedPages.slice(0, -1))} onNext={() => { if (result.nextCursor) { setPageBranch(branchId); setPages([...scopedPages, result.nextCursor]); } }} onPageSizeChange={size => { setLimit(size); setPages([null]); }} itemLabel="correction requests" />
  </section>;
}

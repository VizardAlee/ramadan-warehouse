"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FinancialAction, FinancialActionScope, FinancialValue } from "@/features/finance/financial-privacy";
import type { StockTransferAction } from "@/features/transfers/use-stock-transfer-action";
import type { InternalTradeInvoice } from "../../../functions/src/branch-trading/model";
import { tradeMoney, tradingField, tradingPanel } from "./transfer-trading";

export function DamageReviewForm({invoice, disabled, onSubmit}: {invoice: InternalTradeInvoice; disabled: boolean; onSubmit: (input: StockTransferAction) => Promise<void>}) {
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [decision, setDecision] = useState<"" | "charge" | "no_charge">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const pendingLines = invoice.lines.filter(line => (line.pendingDamagedQuantity ?? 0) > 0);
  const lines = pendingLines.map(line => ({id: line.id, quantity: Number(quantities[line.id] || 0)})).filter(line => line.quantity !== 0);
  const valid = lines.length > 0 && lines.length <= 10 && lines.every(line => Number.isSafeInteger(line.quantity) && line.quantity > 0 && line.quantity <= (pendingLines.find(item => item.id === line.id)!.pendingDamagedQuantity ?? 0));
  const potentialCharge = lines.reduce((sum, line) => sum + line.quantity * pendingLines.find(item => item.id === line.id)!.unitPriceMinor, 0);
  async function save() {
    if (!decision || !valid || !Number.isSafeInteger(potentialCharge) || note.trim().length < 3) { setError("Select valid damaged quantities, explicitly choose charge or no charge, and enter a review note."); return; }
    setError("");
    await onSubmit({action: "review_damage", invoiceId: invoice.id, version: invoice.version, decision, lines, note: note.trim(), idempotencyKey: crypto.randomUUID()});
  }
  if (!pendingLines.length) return null;
  return <FinancialActionScope><section className={tradingPanel}>
    <h2 className="font-semibold">Review damaged arrivals</h2>
    <p className="text-sm">These damaged units have no branch charge yet. Review the damage evidence before deciding whether the branch should pay. This decision changes only the internal charge, not physical stock disposition.</p>
    <fieldset disabled={disabled} className="mt-4 space-y-4">
      {pendingLines.map(line => <label key={line.id} className="block rounded-xl border p-3"><span className="font-medium">{line.productName} · {line.sku}</span><span className="block text-sm">Awaiting review: {line.pendingDamagedQuantity} · Original unit price: <FinancialValue>{tradeMoney(line.unitPriceMinor)}</FinancialValue></span><span className="block">Quantity to review</span><input aria-label={`Damaged quantity to review for ${line.productName}`} className={tradingField} type="number" min="0" max={line.pendingDamagedQuantity} step="1" value={quantities[line.id] ?? ""} onChange={event => setQuantities(old => ({...old, [line.id]: event.target.value}))} /></label>)}
      <label className="block">Review decision<select aria-label="Damage review decision" className={tradingField} value={decision} onChange={event => setDecision(event.target.value as typeof decision)}><option value="">Choose a decision</option><option value="charge">Charge the branch at the original internal price</option><option value="no_charge">Do not charge the branch for these damaged units</option></select></label>
      <p className="font-semibold">Proposed additional branch charge: <FinancialValue>{decision && valid && Number.isSafeInteger(potentialCharge) ? tradeMoney(decision === "charge" ? potentialCharge : 0) : "Not established"}</FinancialValue></p>
      {decision === "no_charge" && <p className="text-sm">The selected units will be marked reviewed with no charge. This does not create a refund or a credit against previously charged goods.</p>}
      <label className="block">Review note<textarea aria-label="Damage review note" className={tradingField} maxLength={1000} value={note} onChange={event => setNote(event.target.value)} /></label>
      <FinancialAction><Button disabled={!decision || !valid} onClick={save}>Save damage review</Button></FinancialAction>
    </fieldset>
    {error && <p role="alert">{error}</p>}
  </section></FinancialActionScope>;
}

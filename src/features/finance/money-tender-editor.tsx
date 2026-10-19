"use client";
import { FinancialAttributes, FinancialInput, FinancialMessage, FinancialText, FinancialValue } from "@/features/finance/financial-privacy";

import { Button } from "@/components/ui/button";
import { formatNaira, nairaToKobo } from "@/features/inventory/format";
import { tenderTotalError, type MoneyTender } from "../../../functions/src/accounting/money-tenders";

export interface MoneyTenderDraft { id: string; method: MoneyTender["method"]; amount: string; bankAccountId: string; reference: string }
export interface TenderBank { branchId?: string | null; id: string; bankName: string; accountName: string; accountNumberLast4: string }
export function parseMoneyTenders(drafts: MoneyTenderDraft[], total: number): { parts: MoneyTender[]; error: string | null } {
  try {
    const parts = drafts.map(draft => ({ method: draft.method, amountMinor: nairaToKobo(Number(draft.amount)), ...(draft.method !== "cash" && draft.bankAccountId ? { bankAccountId: draft.bankAccountId } : {}), ...(draft.reference.trim() ? { reference: draft.reference.trim() } : {}) }));
    return { parts, error: tenderTotalError(parts, total) };
  } catch { return { parts: [], error: "Enter positive amounts with no more than two decimal places." }; }
}
export function MoneyTenderEditor({ value, onChange, total, banks, branchId }: { branchId?: string; value: MoneyTenderDraft[]; onChange: (value: MoneyTenderDraft[]) => void; total: number; banks: TenderBank[] }) {
  const { parts, error } = parseMoneyTenders(value, total);
  function change(id: string, patch: Partial<MoneyTenderDraft>) { onChange(value.map(row => row.id === id ? { ...row, ...patch } : row)); }
  return <section className="space-y-3 rounded-xl border p-3" aria-label="Money payment parts">
    <p className="text-sm">Record the actual cash, card and bank amounts once. These payment parts must total <FinancialValue>{Number.isSafeInteger(total) ? formatNaira(total) : "the transaction amount"}</FinancialValue>. Applying an existing advance is a separate action.</p>
    {value.map((row, index) => <fieldset key={row.id} className="min-w-0 space-y-2 rounded-lg border p-3"><legend className="px-1 text-sm font-semibold">Payment part <FinancialText>{index + 1}</FinancialText></legend>
      <label className="block text-sm">Method<FinancialAttributes><select aria-label={`Part ${index + 1} method`} className="input mt-1 block w-full" value={row.method} onChange={event => change(row.id, { method: event.target.value as MoneyTender["method"], bankAccountId: "" })}><option value="cash">Cash</option><option value="card">Card / POS</option><option value="bank_transfer">Bank transfer</option></select></FinancialAttributes></label>
      <label className="block text-sm">Amount (₦)<FinancialInput><input aria-label={`Part ${index + 1} amount`} type="number" min="0.01" step="0.01" className="input mt-1 block w-full" value={row.amount} onChange={event => change(row.id, { amount: event.target.value })} /></FinancialInput></label>
      {row.method !== "cash" && <label className="block text-sm">Company account<FinancialAttributes><select aria-label={`Part ${index + 1} account`} className="input mt-1 block w-full" value={row.bankAccountId} onChange={event => change(row.id, { bankAccountId: event.target.value })}><option value="">Choose actual account</option>{banks.filter(bank => !bank.branchId || bank.branchId === branchId).map(bank => <option key={bank.id} value={bank.id}><FinancialText>{bank.bankName}</FinancialText> · <FinancialText>{bank.accountName}</FinancialText> · ••••<FinancialText>{bank.accountNumberLast4}</FinancialText></option>)}</select></FinancialAttributes></label>}
      <label className="block text-sm">Reference <FinancialText>{row.method === "cash" ? "(optional)" : "(required)"}</FinancialText><FinancialAttributes><input aria-label={`Part ${index + 1} reference`} maxLength={160} className="input mt-1 block w-full" value={row.reference} onChange={event => change(row.id, { reference: event.target.value })} /></FinancialAttributes></label>
      <Button variant="outline" disabled={value.length <= 1} onClick={() => onChange(value.filter(part => part.id !== row.id))}>Remove part <FinancialText>{index + 1}</FinancialText></Button>
    </fieldset>)}
    <p className="text-sm" role="status"><FinancialMessage>{error || `${formatNaira(parts.reduce((sum, part) => sum + part.amountMinor, 0))} matched exactly.`}</FinancialMessage></p>
    <Button variant="outline" disabled={value.length >= 20} onClick={() => onChange([...value, { id: crypto.randomUUID(), method: "cash", amount: "", bankAccountId: "", reference: "" }])}>Add payment part</Button>
  </section>;
}

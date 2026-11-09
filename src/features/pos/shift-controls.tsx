"use client";
import { AmountInput } from "@/components/ui/amount-input";
import { Button } from "@/components/ui/button";
import { FinancialAction, FinancialActionScope, FinancialInput } from "@/features/finance/financial-privacy";
import type { PosShift, PosWorkspace } from "./types";
interface AccessProps { recovery?: PosWorkspace["shiftRecovery"]; account: string; online: boolean; busy: boolean; canManage: boolean; openingCash: string; onOpeningCash: (value: string) => void; onOpen: () => void; onRetry: () => void }
export function PosShiftAccess({ recovery, account, online, busy, canManage, openingCash, onOpeningCash, onOpen, onRetry }: AccessProps) {
  const blocked = recovery?.status === "other_user" || recovery?.status === "needs_review";
  return <FinancialActionScope><section id="pos-shift" className="mx-auto max-w-xl scroll-mt-40 rounded-2xl border bg-white p-6 shadow-sm">
    <h2 className="text-2xl font-semibold">{blocked ? "Existing device shift requires review" : canManage ? "Open the sales shift" : "A cashier shift is required"}</h2>
    <p className="mt-2 text-sm">Signed in as <strong>{account}</strong>.</p>
    {blocked ? <>
      <p role="alert" className="mt-3 rounded-lg bg-amber-50 p-3 text-sm">{recovery.message}</p>
      <p className="mt-3 text-sm">Signing out does not close a cash shift. Resume with the account that opened this device’s shift, or ask an authorized supervisor to review the shift and counted cash. Another browser does not need to be open for this lock to remain.</p>
      <p className="mt-2 text-sm">Different devices can run separate cashier shifts in the same branch at the same time.</p>
      <Button type="button" className="mt-4" variant="outline" disabled={!online || busy} onClick={onRetry}>Retry device shift</Button>
    </> : canManage ? <>
      <p className="mt-2 text-sm text-[var(--muted)]">Count the cash physically in this till before the first sale. This opening figure is used only for cash reconciliation.</p>
      <label className="mt-5 block text-sm font-medium">Opening cash (₦)<FinancialInput><AmountInput type="number" min="0" step="0.01" inputMode="decimal" value={openingCash} onValueChange={rawAmount => onOpeningCash(rawAmount)} className="mt-1 w-full rounded-lg border p-3 text-lg" /></FinancialInput></label>
      <FinancialAction><Button type="button" className="mt-5 w-full" disabled={!online || busy} onClick={onOpen}>Open shift and start selling</Button></FinancialAction>
      {!online && <p className="mt-2 text-sm text-amber-800">Open a new shift online. An already-open cached shift can continue offline.</p>}
    </> : <p className="mt-3 text-sm">Your current permissions do not open or close cash shifts. Use your authorized workflow actions above, or ask the cashier or supervisor to review shift access.</p>}
  </section></FinancialActionScope>;
}
export function PosActiveShift({ shift, account, canManage, online, busy, pendingOrder, closingCash, onClosingCash, onClose }: { shift: PosShift; account: string; canManage: boolean; online: boolean; busy: boolean; pendingOrder: boolean; closingCash: string; onClosingCash: (value: string) => void; onClose: () => void }) {
  return <FinancialActionScope><section id="pos-shift-controls" className="scroll-mt-40 rounded-xl border bg-white p-4">
    <h2 className="font-semibold">Your active device shift</h2><p className="mt-1 text-sm">{shift.deviceName} · Signed in as {account}.</p>
    {canManage && <details className="mt-3 border-t pt-3"><summary className="min-h-10 cursor-pointer font-semibold">Close shift</summary>
      <p className="mt-2 text-sm">Count the cash in this till. Closing reconciles this shift; it does not close another cashier’s device shift.</p>
      {pendingOrder && <p className="mt-2 text-sm text-amber-800">Resolve the pending order before closing this shift.</p>}
      <label className="mt-3 block text-sm">Counted closing cash (₦)<FinancialInput><AmountInput type="number" min="0" step="0.01" value={closingCash} onValueChange={rawAmount => onClosingCash(rawAmount)} className="mt-1 w-full max-w-sm rounded-lg border p-2.5" /></FinancialInput></label>
      <FinancialAction><Button type="button" className="mt-3" variant="outline" disabled={!online || !closingCash || busy || pendingOrder} onClick={onClose}>Close and reconcile shift</Button></FinancialAction>
    </details>}
  </section></FinancialActionScope>;
}

"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import { useAuth } from "@/features/auth/auth-context";
import { FinancialDocument, FinancialMessage, FinancialPrintAction, FinancialValue } from "@/features/finance/financial-privacy";
import { hasPermission } from "@/lib/permissions/roles";
import type { InternalTradeInvoice, InternalTradeWorkspace } from "../../../functions/src/branch-trading/model";
import { InvoiceTradingActions } from "./invoice-trading-actions";
import { InternalTradeInvoiceCard, TradeInvoiceAmounts, tradeMoney, tradingField, tradingPanel } from "./transfer-trading";

export function BranchTradingWorkspace({ invoiceId }: {invoiceId?: string}) {
  const { profile, operatingContext } = useAuth();
  if (!profile) return <p>Loading your access…</p>;
  const scope = operatingContext ? `${operatingContext.type}:${operatingContext.id}` : "organization";
  return <TradingWorkspace key={`${profile.organizationId}:${profile.uid}:${scope}:${invoiceId ?? ""}`} owner={`${profile.organizationId}:${profile.uid}`} scope={scope} initialBranchId={operatingContext?.type === "branch" ? operatingContext.id : undefined} invoiceId={invoiceId} canProcure={hasPermission(profile, "procurement.read")} />;
}
function TradingWorkspace({ owner, scope, initialBranchId, invoiceId, canProcure }: {owner: string; scope: string; initialBranchId?: string; invoiceId?: string; canProcure: boolean}) {
  const [branchId, setBranchId] = useState(initialBranchId ?? "");
  const [state, setState] = useState<{branchId: string; data: InternalTradeWorkspace} | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const load = useCallback(async (cursor?: string, entriesCursor?: string) => {
    const request = ++generation.current;
    setLoading(true); setError("");
    try {
      const data = await callAdministration<object, InternalTradeWorkspace>("stockTransfers", { action: "trading_workspace", ...(branchId ? {branchId} : {}), ...(invoiceId ? {invoiceId} : {}), ...(cursor ? {cursor} : {}), ...(entriesCursor ? {entriesCursor} : {}) });
      if (generation.current !== request) return;
      setState(old => ({branchId, data: {...data, entries: entriesCursor && old?.branchId === branchId ? [...old.data.entries, ...data.entries.filter(entry => !old.data.entries.some(existing => existing.id === entry.id))] : data.entries, invoices: cursor && old?.branchId === branchId ? [...old.data.invoices, ...data.invoices.filter(invoice => !old.data.invoices.some(existing => existing.id === invoice.id))] : data.invoices}}));
    } catch (cause) { if (generation.current === request) setError(cause instanceof Error ? cause.message : "Unable to load internal accounts."); }
    finally { if (generation.current === request) setLoading(false); }
  }, [branchId, invoiceId]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => { window.clearTimeout(timer);
      // Invalidate requests rather than allowing a previous branch to populate this screen.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
    };
  }, [load]);
  const data = state?.branchId === branchId ? state.data : null;
  return <div className="space-y-5">
    <header><Link href="/transfers" className="text-sm underline">Stock transfers</Link><h1 className="mt-2 text-2xl font-semibold">Head-office and branch accounts</h1><p className="mt-2 text-sm text-[var(--muted)]">Internal invoices and branch balances are separate from external sales and supplier purchases. Internal trading does not increase company revenue, profit or inventory value. Existing profit reports use company cost; internal purchases are not a profit calculation.</p>{canProcure && <Link href="/procurement" className="mt-2 inline-block underline">Purchases from outside suppliers</Link>}</header>
    <div className="flex flex-wrap items-end gap-3" data-no-print>{!invoiceId && <label className="min-w-48">Branch<select className={tradingField} value={branchId} disabled={Boolean(initialBranchId)} onChange={event => { generation.current++; setBranchId(event.target.value); }}><option value="">All permitted branches</option>{(state?.data.branches ?? (initialBranchId ? [{id: initialBranchId, name: "Current branch"}] : [])).map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>}<Button variant="secondary" disabled={loading} onClick={() => void load()}>Refresh accounts</Button>{invoiceId && <Link href="/transfers/accounts" className="underline">All internal invoices</Link>}</div>
    {error && <p role="alert"><FinancialMessage>{error}</FinancialMessage></p>}
    {loading && <p role="status">Loading internal accounts…</p>}
    {data && !data.canReadTrading && <p>You do not have access to internal trading accounts.</p>}
    {data?.canReadTrading && <>
      <section className={tradingPanel}><h2 className="font-semibold">Full branch balances</h2><p className="mb-4 text-sm">Persisted balances across all internal invoices, not totals of the displayed page.</p>{!data.balances.length && <p>No internal balance recorded.</p>}<div className="space-y-4">{data.balances.map(balance => <div key={`${balance.headOfficeBranchId}:${balance.branchId}`} className="border-t pt-3"><h3 className="font-semibold">{data.branches.find(branch => branch.id === balance.branchId)?.name ?? balance.branchId}</h3><p className="mb-2 text-sm">Head office: {balance.headOfficeBranchName ?? data.branches.find(branch => branch.id === balance.headOfficeBranchId)?.name ?? balance.headOfficeBranchId}</p><dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">{[["Invoiced", balance.invoicedMinor], ["Returned goods credit", balance.returnedMinor], ["Paid", balance.paidMinor], [balance.balanceMinor < 0 ? "Branch credit" : "Outstanding", Math.abs(balance.balanceMinor)]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd><FinancialValue>{tradeMoney(Number(value))}</FinancialValue></dd></div>)}</dl></div>)}</div></section>
      {!data.invoices.length && <p>{invoiceId ? "This invoice is unavailable in the current working location." : "No internal invoices yet. Legacy transfers do not create internal charges."}</p>}
      {data.invoices.map(invoice => invoiceId ? <section key={invoice.id} className="space-y-5"><InvoiceDocument invoice={invoice} entries={data.entries} />{data.nextEntriesCursor && <Button disabled={loading} onClick={() => void load(undefined, data.nextEntriesCursor!)}>Load more account entries</Button>}<InvoiceTradingActions key={`${invoice.id}:${branchId}`} invoice={invoice} workspace={data} owner={`${owner}:${invoice.id}`} scope={scope} onComplete={() => load()} /></section> : <InternalTradeInvoiceCard key={invoice.id} invoice={invoice} />)}
      {data.nextCursor && <Button disabled={loading} onClick={() => void load(data.nextCursor!)}>Load more invoices</Button>}
    </>}
  </div>;
}
function InvoiceDocument({ invoice, entries }: {invoice: InternalTradeInvoice; entries: InternalTradeWorkspace["entries"]}) {
  return <FinancialDocument><article data-print-document className={tradingPanel}><div className="flex flex-wrap justify-between gap-3"><h2 className="text-xl font-semibold">Internal invoice {invoice.number}</h2><FinancialPrintAction><Button data-no-print variant="secondary" onClick={() => window.print()}>Print internal invoice</Button></FinancialPrintAction></div><p>Head office: {invoice.headOfficeBranchName ?? invoice.headOfficeBranchId}</p><p>{invoice.branchName} · {new Date(invoice.createdAt).toLocaleDateString("en-NG")}</p><p className="my-3 text-sm">Internal branch purchase only. Not an external sale or VAT invoice. Damaged arrivals are not charged while awaiting administrator review.</p><Link href={`/transfers/simple/${encodeURIComponent(invoice.transferId)}`} className="underline">Original stock transfer</Link><div className="my-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Product / lot</th><th className="p-2">Good units received</th><th className="p-2">Damaged arrivals</th><th className="p-2">Returned</th><th className="p-2">Unit price</th><th className="p-2">Charged total before returns</th></tr></thead><tbody>{invoice.lines.map(line => <tr key={line.id} className="border-t"><td className="p-2">{line.productName}<span className="block text-xs">{line.sku}{line.lotId ? ` · Lot ${line.lotId}` : ""}</span>{line.serialItemIds.length > 0 && <details><summary>Received serial numbers</summary>{line.serialItemIds.map(id => line.serialNumbers?.[id] ?? id).join(", ")}{line.returnedSerialItemIds.length > 0 && <p>Returned: {line.returnedSerialItemIds.map(id => line.serialNumbers?.[id] ?? id).join(", ")}</p>}</details>}</td><td className="p-2">{line.receivedQuantity}</td><td className="p-2"><span className="block">Held for review: {line.pendingDamagedQuantity ?? 0}</span><span className="block">Reviewed, charged: {line.chargedDamagedQuantity ?? 0}</span><span className="block">Reviewed, no charge: {line.waivedDamagedQuantity ?? 0}</span></td><td className="p-2">{line.returnedQuantity}</td><td className="p-2"><FinancialValue>{tradeMoney(line.unitPriceMinor)}</FinancialValue></td><td className="p-2"><FinancialValue>{tradeMoney(line.unitPriceMinor * (line.receivedQuantity + (line.chargedDamagedQuantity ?? 0)))}</FinancialValue></td></tr>)}</tbody></table></div><TradeInvoiceAmounts invoice={invoice} /><section className="mt-6 border-t pt-4"><h3 className="font-semibold">Account entries</h3><p className="text-sm">Recorded invoice charges, payments and returned-goods credits. The invoice balance includes all entries, including entries not yet displayed.</p><div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Date</th><th className="p-2">Entry</th><th className="p-2">Reference</th><th className="p-2">Amount</th></tr></thead><tbody>{entries.map(entry => <tr key={entry.id} className="border-t"><td className="p-2">{new Date(entry.effectiveAt || entry.createdAt).toLocaleString("en-NG")}</td><td className="p-2">{entry.kind === "invoice" ? "Invoice charge" : entry.kind === "payment" ? "Payment" : entry.kind === "damage_hold" ? "Damaged arrival held for review" : entry.kind === "damage_charge" ? "Damaged goods charged after review" : entry.kind === "damage_waiver" ? "Damaged goods reviewed, no charge" : "Returned goods credit"}</td><td className="p-2">{entry.reference ?? entry.id}</td><td className="p-2"><FinancialValue>{tradeMoney(entry.amountMinor)}</FinancialValue></td></tr>)}</tbody></table>{!entries.length && <p>No account entries displayed.</p>}</div></section></article></FinancialDocument>;
}

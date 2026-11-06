"use client";
import { useEffect, useState } from "react";
import { AppDialog } from "@/components/ui/app-dialog";
import { useDialogFocus } from "@/components/ui/use-dialog-focus";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import { FinancialDocument, FinancialPrintAction, FinancialValue } from "@/features/finance/financial-privacy";
import { formatNaira } from "@/features/inventory/format";
interface Voucher { orderNumber: string; branchName: string; customerName: string; status: string; grossAmountMinor: number; createdBy: string; lines: Array<{ productName: string; quantity: number }> }
export function SalesVoucher({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const dialogRef = useDialogFocus<HTMLElement>(true, onClose);
  const [data, setData] = useState<Voucher>(), [error, setError] = useState("");
  useEffect(() => { let active = true; void callAdministration<object, Voucher>("getSaleDocument", { action: "get_sales_voucher", orderId }).then(value => { if (active) setData(value); }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Voucher could not be loaded."); }); return () => { active = false; }; }, [orderId]);
  return <AppDialog role="dialog" aria-modal="true" aria-labelledby="sales-voucher-heading"><section ref={dialogRef} className="app-dialog-panel max-w-2xl bg-white p-6" data-print-document><FinancialDocument>
    <h1 id="sales-voucher-heading" className="text-2xl font-semibold">Sales voucher</h1><p>Take this voucher to the cashier. It is not a receipt or proof of collection.</p>
    {error && <p role="alert">{error}</p>}{!data && !error && <p role="status">Loading voucher…</p>}
    {data && <><p className="mt-4 font-semibold">{data.orderNumber} · {data.branchName}</p><p>{data.customerName} · {data.status.replaceAll("_", " ")}</p><table className="my-4 w-full text-left"><thead><tr><th>Product / service</th><th>Quantity</th></tr></thead><tbody>{data.lines.map((line, index) => <tr key={index}><td>{line.productName}</td><td>{line.quantity}</td></tr>)}</tbody></table><p>Total: <FinancialValue>{formatNaira(data.grossAmountMinor)}</FinancialValue></p><p className="mt-3 text-sm">Cashier confirmation is required before goods can await store handover. Each handover is confirmed separately by authorized store staff.</p><FinancialPrintAction><Button className="mt-4" onClick={() => window.print()}>Print sales voucher</Button></FinancialPrintAction></>}
    <Button className="ml-2 mt-4" variant="outline" onClick={onClose}>Close</Button>
  </FinancialDocument></section></AppDialog>;
}

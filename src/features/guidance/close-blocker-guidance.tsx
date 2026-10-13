import Link from "next/link";
import {hasAnyPermission} from "@/lib/permissions/roles";
import type {PermissionId, UserProfile} from "@/types/domain";
const sources: Record<string,{href:string;label:string;permissions:PermissionId[];instruction:string}> = {
 BANK_RECONCILIATION_REQUIRED:{href:"/banking",label:"Review bank reconciliations",permissions:["banking.read"],instruction:"Ask authorized bank reconciliation staff to match and complete the exact month's real account evidence before closing."},
 OPEN_POS_SHIFTS:{href:"/pos",label:"Review POS shifts",permissions:["sales.create","sales.order.create","sales.payment.accept","sales.payment.confirm","sales.stock.release"],instruction:"Ask assigned cashier or shift staff to reconcile queued orders and physically counted cash, then close the original tills."},
 PENDING_EXPENSES:{href:"/expenses",label:"Review expense queue",permissions:["expenses.read"],instruction:"Ask the assigned expense creator/approver to resolve the listed draft or submitted expenses using original evidence."},
 PENDING_SUPPLIER_INVOICES:{href:"/procurement",label:"Review supplier invoices",permissions:["procurement.read","payables.read"],instruction:"Ask purchasing/payables staff to resolve the listed supplier invoice matching and approvals; do not invoice undelivered goods."},
 PENDING_SALE_RETURNS:{href:"/returns",label:"Review return queue",permissions:["sales.returns.read"],instruction:"Ask return inspection/approval staff to resolve the listed physical, cancellation or commercial-credit stage."},
};
export function CloseBlockerGuidance({code,profile}:{code:string;profile:UserProfile|null}) {
 const source=sources[code];
 if(!source)return <p className="mt-2">{code==="PERIOD_NOT_ENDED" ? "Choose an ended accounting month before preparation." : "Ask an authorized accountant to reconcile the original journal/ledger evidence shown in this blocker. Preserve posted history and never invent balancing amounts."}</p>;
 return <p className="mt-2">{source.instruction} {profile && hasAnyPermission(profile,source.permissions) && <Link className="inline-flex min-h-11 items-center font-semibold underline" href={source.href}>{source.label}</Link>}</p>;
}

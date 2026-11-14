import { FieldValue, Timestamp, type DocumentSnapshot, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import type { AccessProfile } from "../auth/authorize.js";
import type { StockTransfer } from "../transfers/simple-model.js";
import type { TransferTransportPlan } from "./model.js";
import { accountingPeriodReference, assertAccountingPeriodOpen } from "../accounting/period-lock.js";
const norm = (value: unknown) => String(value ?? "").trim().replace(/\s+/g," ").toUpperCase();
function fail(message:string):never { throw new HttpsError("failed-precondition",message); }
export function validateTransportExpense(expense:DocumentSnapshot, organizationId:string, transfer:StockTransfer, plan:Pick<TransferTransportPlan,"totalMinor"|"payer"|"payee"|"reference">) {
  if (!expense.exists || expense.get("organizationId")!==organizationId || !["approved","partially_paid","paid"].includes(expense.get("status"))) fail("Transport must link an approved expense. Record and approve it once in Expenses first.");
  const payerBranch = plan.payer === "destination" ? transfer.destinationBranchId : transfer.sourceBranchId ?? transfer.tradeAgreement?.headOfficeBranchId;
  const payerMatches = expense.get("branchId") === payerBranch || (plan.payer === "source" && transfer.sourceWarehouseId && expense.get("warehouseId") === transfer.sourceWarehouseId);
  if (!payerMatches || norm(expense.get("payeeName"))!==norm(plan.payee) || norm(expense.get("supplierDocumentNumber"))!==norm(plan.reference)) fail("Transport payer, payee and external document reference must match the approved expense.");
  if (expense.get("netAmountMinor")!==plan.totalMinor || expense.get("costReferenceId") || expense.get("costPurpose")==="service") fail("Use the exact net amount of an independent transport expense, excluding recoverable VAT and costs already linked to a sale or service.");
  if (expense.get("transportTransferId") && expense.get("transportTransferId")!==transfer.id) fail("This transport expense is already allocated to another transfer.");
}
/** Reclassifies an existing accrued expense; creates neither cash nor a second
 * payable. Normal expense payment later settles the existing payable once.
 */
export async function prepareTransportCapitalization(tx:Transaction, actor:AccessProfile, transfer:StockTransfer, amountMinor:number, now:string, key:string):Promise<()=>void> {
  const plan=transfer.tradeAgreement?.transport;
  if (!plan || !amountMinor) return ()=>{};
  if (!Number.isSafeInteger(amountMinor) || amountMinor<0) fail("Invalid transport capitalization amount.");
  const expenseRef=db.doc(`expenses/${plan.expenseId}`);
  const [expense,period]=await tx.getAll(expenseRef,accountingPeriodReference(actor.organizationId,now));
  validateTransportExpense(expense!,actor.organizationId,transfer,plan);
  assertAccountingPeriodOpen(period!);
  const prior=Number(expense!.get("transportCapitalizedMinor") ?? 0);
  if (!Number.isSafeInteger(prior) || prior<0 || prior+amountMinor>plan.totalMinor) fail("Transport has already been capitalized or requires reconciliation.");
  const journal=db.doc(`journalEntries/transport_${transfer.id}_${transfer.version}`);
  const effectiveAt=Timestamp.fromDate(new Date(now));
  const journalNumber=`FRT-${transfer.number}-${transfer.version}`;
  const scope={...(expense!.get("branchId")?{branchId:expense!.get("branchId")}:{}),...(expense!.get("warehouseId")?{warehouseId:expense!.get("warehouseId")}: {})};
  return ()=>{
    tx.update(expenseRef,{transportTransferId:transfer.id,transportCapitalizedMinor:prior+amountMinor,updatedAt:FieldValue.serverTimestamp()});
    const base={organizationId:actor.organizationId,...scope,currency:"NGN",effectiveAt,postedAt:FieldValue.serverTimestamp(),createdAt:FieldValue.serverTimestamp()};
    tx.create(journal,{...base,journalNumber,journalType:"transport_capitalization",status:"posted",referenceType:"stockTransfer",referenceId:transfer.id,referenceNumber:transfer.number,expenseId:plan.expenseId,expenseNumber:plan.expenseNumber,totalDebitMinor:amountMinor,totalCreditMinor:amountMinor,postedBy:actor.userId,createdBy:actor.userId,idempotencyKey:key});
    for(const line of [{accountCode:"1200",accountName:"Inventory asset",debitMinor:amountMinor,creditMinor:0},{accountCode:"6000",accountName:"Operating expenses",debitMinor:0,creditMinor:amountMinor}]) {
      tx.create(db.collection("journalLines").doc(),{...base,...(line.accountCode === "1200" ? {branchId:transfer.destinationBranchId, ...(scope.warehouseId ? {warehouseId:null} : {})} : {}),...line,journalEntryId:journal.id,journalNumber,managementDebitMinor:line.debitMinor,managementCreditMinor:line.creditMinor});
    }
  };
}

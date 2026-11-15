import { FieldValue, Timestamp, type DocumentSnapshot, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import { requirePermission } from "../auth/authorize.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import { accountingPeriodReference, assertAccountingPeriodOpen } from "../accounting/period-lock.js";
import { writeJournal } from "../accounting/write-journal.js";
import { internalTradeBalanceId, internalTradeSupplier } from "../branch-trading/identity.js";
import { internalTransferMovementValue, balanceDocumentId, normalizeInventoryIdentifier, uniquenessDocumentId } from "../inventory/calculations.js";
import { requestFingerprint } from "../utils/request-fingerprint.js";
import { requireProcurementScope, type ProcurementAccess } from "./authorize.js";
import { planPurchaseReclassification, type ReclassificationEvidence } from "./purchase-reclassification-plan.js";

export interface ReclassificationSelection {
  supplierInvoiceIds: string[];
  lines: {supplierInvoiceItemId:string;externalSupplierId?:string;sourceLocationId?:string}[];
  confirmedZeroTransport: true;
  confirmedSourceNotPreviouslyIssued: true;
}
export interface ReclassificationExecutionInput extends ReclassificationSelection {
  expectedEvidenceFingerprint:string;idempotencyKey:string;reason:string;
}
function fail(message:string):never { throw new HttpsError("failed-precondition", message, {code:"PURCHASE_RECLASSIFICATION_REVIEW_REQUIRED"}); }
const id = (value:unknown):string => {
  if(typeof value!=="string" || !value.trim() || value!==value.trim() || value.length>128 || value.includes("/") || value==="." || value==="..") fail("Invalid correction document identity.");
  return value as string;
};
const num = (value:unknown):number => {
  if(typeof value!=="number" || !Number.isSafeInteger(value) || value<0 || value>100_000_000_000_000) fail("Correction amounts or quantities require reconciliation.");
  return value as number;
};
const optionalNum = (doc:DocumentSnapshot, key:string) => num(doc.get(key) ?? 0);
const scope = (doc:DocumentSnapshot) => ({...(doc.get("branchId")?{branchId:String(doc.get("branchId"))}:{}),...(doc.get("warehouseId")?{warehouseId:String(doc.get("warehouseId"))}:{})});
const clean = (row:Record<string,unknown>) => Object.fromEntries(Object.entries(row).filter(([,v])=>v!==undefined));
function authorize(actor:ProcurementAccess) {
  const roles=actor.directRoleIds ?? (actor.effectivePermissions ? [] : actor.roleIds ?? [actor.roleId]);
  if(!roles.includes("system_administrator")) throw new HttpsError("permission-denied","Only a directly assigned system administrator may reconcile this historical batch.");
  for(const permission of ["finance.journal.reverse","payables.approve","procurement.receive","inventory.move_internal"] as const) requirePermission(actor,permission);
}
function selection(input:ReclassificationSelection) {
  if(input.confirmedZeroTransport!==true || input.confirmedSourceNotPreviouslyIssued!==true || !Array.isArray(input.supplierInvoiceIds) || input.supplierInvoiceIds.length!==3 || new Set(input.supplierInvoiceIds).size!==3 || !Array.isArray(input.lines) || input.lines.length!==6 || new Set(input.lines.map(l=>l.supplierInvoiceItemId)).size!==6) fail("Review exactly three invoices, six lines, zero transport and source issue history before proceeding.");
  input.supplierInvoiceIds.forEach(id);
  for(const line of input.lines) { id(line.supplierInvoiceItemId); if(Boolean(line.externalSupplierId)===Boolean(line.sourceLocationId)) fail("Each line requires exactly one actual supplier or source location."); if(line.externalSupplierId) id(line.externalSupplierId); if(line.sourceLocationId) id(line.sourceLocationId); }
}
type LineState = {line:DocumentSnapshot;item:DocumentSnapshot;receipt:DocumentSnapshot;movement:DocumentSnapshot;product:DocumentSnapshot;invoice:DocumentSnapshot;source?:DocumentSnapshot;sourceBalance?:DocumentSnapshot;quantity:number;value:number;externalSupplierId?:string};
/** Both preview and execution use the same transactional server reads. Client flags
 * are confirmations, never substitutes for verified stock/accounting provenance.
 */
async function prepare(tx:Transaction,actor:ProcurementAccess,input:ReclassificationSelection,now:Timestamp) {
  selection(input);
  input={supplierInvoiceIds:input.supplierInvoiceIds,lines:input.lines,confirmedZeroTransport:true,confirmedSourceNotPreviouslyIssued:true};
  const evidenceRows:Record<string,unknown>[]=[];
  const remember=(doc:DocumentSnapshot)=>{ evidenceRows.push({path:doc.ref.path,exists:doc.exists,data:doc.data()}); return doc; };
  const get=async(path:string)=>remember(await tx.get(db.doc(path)));
  const query=async(collection:string,field:string,value:string,limit=101)=>{
    const rows=await tx.get(db.collection(collection).where(field,"==",value).limit(limit));
    if(rows.size===limit) fail(`${collection} history exceeds the bounded correction review. No partial history was accepted.`);
    rows.docs.forEach(remember); return rows.docs;
  };
  const owned=(doc:DocumentSnapshot)=>{ if(!doc.exists || doc.get("organizationId")!==actor.organizationId) fail("Correction evidence is missing or belongs to another organization."); return doc; };
  const invoices=await Promise.all(input.supplierInvoiceIds.map(invoiceId=>get(`supplierInvoices/${invoiceId}`).then(owned)));
  const organization=await get(`organizations/${actor.organizationId}`);
  if(!organization.exists) fail("Organization configuration is unavailable.");
  const period=remember(await tx.get(accountingPeriodReference(actor.organizationId,now))); assertAccountingPeriodOpen(period);
  const counter=await get(`journalCounters/${uniquenessDocumentId(actor.organizationId,"general")}`);
  if(counter.exists && counter.get("organizationId")!==actor.organizationId) fail("Journal sequence ownership requires review.");
  for(const code of ["1200","2000"]) { const account=owned(await get(`chartOfAccounts/${uniquenessDocumentId(actor.organizationId,code)}`)); if(account.get("code")!==code || account.get("active")!==true || account.get("currency")!=="NGN") fail("Inventory and payable accounts must be active and verified before correction."); }
  const oldSupplierId=id(invoices[0]!.get("supplierId"));
  const oldSupplier=owned(await get(`suppliers/${oldSupplierId}`));
  const destinationId=id(invoices[0]!.get("branchId"));
  const destinationBranch=owned(await get(`branches/${destinationId}`));
  const sourceIds=new Set(input.lines.flatMap(l=>l.sourceLocationId?[l.sourceLocationId]:[]));
  if(sourceIds.size!==1) fail("This correction requires one confirmed Head Office source location.");
  const source=owned(await get(`inventoryLocations/${[...sourceIds][0]}`));
  if(source.get("status")!=="active" || !["warehouse","branch"].includes(source.get("type"))) fail("Choose an active Head Office stock location.");
  requireProcurementScope(actor,scope(source),["procurement.receive","payables.approve"]);
  const destination=owned(await get(`inventoryLocations/${id(invoices[0]!.get("receivingLocationId") ?? (await get(`purchaseOrders/${id(invoices[0]!.get("purchaseOrderId"))}`)).get("receivingLocationId"))}`));
  if(destination.get("type")!=="branch" || destination.get("branchId")!==destinationId || destination.get("status")!=="active" || destinationBranch.get("status")!=="active") fail("Destination receiving location requires review.");
  const headOfficeBranchId=internalTradeSupplier(organization.data()!,source.data()!,destination.data()!);
  if(!headOfficeBranchId || headOfficeBranchId!==organization.get("headOfficeBranchId")) fail("The selected source is not the configured Head Office supplying store.");
  const headOffice=owned(await get(`branches/${headOfficeBranchId}`));
  if(headOffice.get("branchType")!=="head_office" || headOffice.get("status")!=="active") fail("Head Office identity requires review.");
  const externalIds=[...new Set(input.lines.flatMap(l=>l.externalSupplierId?[l.externalSupplierId]:[]))];
  if(externalIds.includes(oldSupplierId)) fail("Confirm the actual external suppliers, not the original Head Office supplier.");
  const externalSuppliers=await Promise.all(externalIds.map(s=>get(`suppliers/${s}`).then(owned)));
  if(externalSuppliers.some(s=>s.get("active")!==true || typeof s.get("name")!=="string" || typeof s.get("supplierNumber")!=="string")) fail("External suppliers must be active with complete names and supplier numbers.");
  const lines:LineState[]=[], orders:DocumentSnapshot[]=[];
  const evidence:ReclassificationEvidence={organizationId:actor.organizationId,transportMinor:0,currentPeriodOpen:true,sourceLocationConfirmed:true,sourceNotPreviouslyIssuedConfirmed:true,hasDependentReturnsOrCredits:false,invoices:[]};
  for(const invoice of invoices) {
    requireProcurementScope(actor,scope(invoice),["payables.approve","procurement.receive","procurement.create"]);
    if(invoice.get("branchId")!==destinationId || invoice.get("warehouseId") || invoice.get("supplierId")!==oldSupplierId || invoice.get("status")!=="approved" || invoice.get("reclassificationId") || invoice.get("lastPaymentId") || optionalNum(invoice,"paidAmountMinor") || optionalNum(invoice,"creditedAmountMinor")) fail("Only original unpaid, uncredited, approved destination invoices can be reclassified.");
    const order=owned(await get(`purchaseOrders/${id(invoice.get("purchaseOrderId"))}`)); orders.push(order);
    if(orders.filter(o=>o.id===order.id).length!==1 || order.get("supplierId")!==oldSupplierId || order.get("branchId")!==destinationId || order.get("warehouseId") || order.get("status")!=="received" || order.get("receivingLocationId")!==destination.id || order.get("reclassificationId")) fail("Original purchase order provenance requires review.");
    const siblings=await query("supplierInvoices","purchaseOrderId",order.id,5);
    if(siblings.length!==1 || siblings[0]!.id!==invoice.id) fail("Split or additional invoices require separate reconciliation.");
    for(const collection of ["supplierPaymentAllocations","supplierReturns"]) if((await query(collection,"supplierInvoiceId",invoice.id,2)).length) fail("Payments or returns already depend on this invoice.");
    const originalPeriod=remember(await tx.get(accountingPeriodReference(actor.organizationId,String(invoice.get("invoiceDate"))))); assertAccountingPeriodOpen(originalPeriod);
    const journal=owned(await get(`journalEntries/${id(invoice.get("journalEntryId"))}`));
    const net=num(invoice.get("netAmountMinor"));
    if(invoice.get("vatAmountMinor")!==0 || invoice.get("grossAmountMinor")!==net || invoice.get("outstandingAmountMinor")!==net || order.get("netAmountMinor")!==net || order.get("grossAmountMinor")!==net || order.get("vatAmountMinor")!==0 || order.get("receivedNetAmountMinor")!==net || order.get("invoicedNetAmountMinor")!==net) fail("Only complete zero-VAT invoices with matching order totals are supported.");
    if(journal.get("status")!=="posted" || journal.get("journalType")!=="supplier_invoice" || journal.get("referenceType")!=="supplierInvoice" || journal.get("referenceId")!==invoice.id || journal.get("branchId")!==destinationId || journal.get("warehouseId") || journal.get("currency")!=="NGN" || journal.get("totalDebitMinor")!==net || journal.get("totalCreditMinor")!==net || journal.get("reversalJournalEntryId") || journal.get("reversedByJournalEntryId")) fail("Original invoice journal requires reconciliation.");
    const journalLines=await query("journalLines","journalEntryId",journal.id,4);
    const expected=[{code:"1200",debit:net,credit:0},{code:"2000",debit:0,credit:net}];
    if(journalLines.length!==2 || expected.some(e=>!journalLines.some(l=>l.get("organizationId")===actor.organizationId && l.get("branchId")===destinationId && l.get("accountCode")===e.code && l.get("debitMinor")===e.debit && l.get("creditMinor")===e.credit && (l.get("managementDebitMinor")??e.debit)===e.debit && (l.get("managementCreditMinor")??e.credit)===e.credit))) fail("Original journal lines do not match the invoice.");
    const accountEntries=await query("supplierAccountEntries","referenceId",invoice.id,4);
    if(accountEntries.length!==1 || accountEntries[0]!.get("organizationId")!==actor.organizationId || accountEntries[0]!.get("supplierId")!==oldSupplierId || accountEntries[0]!.get("entryType")!=="supplier_invoice" || accountEntries[0]!.get("amountMinor")!==net) fail("Original supplier account entry requires review.");
    const invoiceLines=await query("supplierInvoiceItems","supplierInvoiceId",invoice.id,8);
    const orderLines=await query("purchaseOrderItems","purchaseOrderId",order.id,8);
    if(invoiceLines.length!==orderLines.length) fail("Invoice must cover every ordered product exactly once.");
    const mapped:ReclassificationEvidence["invoices"][number]["lines"]=[];
    for(const line of invoiceLines) {
      owned(line); const choice=input.lines.find(l=>l.supplierInvoiceItemId===line.id);
      if(!choice) fail("Every original invoice line requires a reviewed classification.");
      const item=orderLines.find(l=>l.id===line.get("purchaseOrderItemId"));
      if(!item) fail("Invoice product has no original purchase item."); owned(item);
      const quantity=num(line.get("quantity")),unitCost=num(line.get("unitCostMinor")),value=num(quantity*unitCost);
      if(!quantity || !unitCost || item.get("productId")!==line.get("productId") || item.get("trackingType")!=="quantity" || item.get("orderedQuantity")!==quantity || item.get("receivedQuantity")!==quantity || item.get("invoicedQuantity")!==quantity || item.get("unitCostMinor")!==unitCost || line.get("netAmountMinor")!==value || line.get("vatAmountMinor")!==0 || line.get("grossAmountMinor")!==value || optionalNum(line,"returnedQuantity") || optionalNum(item,"returnedQuantity") || item.get("receiptInProgressKey") || item.get("costCorrectionId")) fail("Only complete untouched quantity-tracked lines are supported.");
      const product=owned(await get(`products/${id(line.get("productId"))}`));
      if(typeof product.get("name")!=="string" || typeof product.get("sku")!=="string") fail("Product identity is incomplete.");
      if(product.get("trackingType")!=="quantity") fail("Serial or batch products require separate correction support.");
      const invoiceCounter=owned(await get(`purchaseInvoiceItemCounters/${uniquenessDocumentId(actor.organizationId,"purchaseInvoiceItem",item.id)}`));
      if(invoiceCounter.get("invoicedQuantity")!==quantity || invoiceCounter.get("purchaseOrderId")!==order.id || invoiceCounter.get("purchaseOrderItemId")!==item.id) fail("Invoice consumption counter requires review.");
      const receipts=await query("purchaseReceipts","purchaseOrderItemId",item.id,3);
      if(receipts.length!==1) fail("Split receipts require separate reconciliation.");
      const receipt=owned(receipts[0]!);
      if(receipt.get("purchaseOrderId")!==order.id || receipt.get("supplierId")!==oldSupplierId || receipt.get("productId")!==product.id || receipt.get("quantity")!==quantity || receipt.get("unitCostMinor")!==unitCost || receipt.get("netAmountMinor")!==value || receipt.get("receivingLocationId")!==destination.id || optionalNum(receipt,"returnedQuantity") || receipt.get("lotNumber") || receipt.get("reclassificationId")) fail("Original goods receipt does not match its invoice.");
      if((await query("supplierReturns","receiptId",receipt.id,2)).length) fail("A supplier return depends on this receipt.");
      const movement=owned(await get(`inventoryTransactions/${id(receipt.get("inventoryTransactionId"))}`));
      if(movement.get("status")!=="posted" || movement.get("transactionType")!=="inventory_receipt" || movement.get("referenceType")!=="purchase_order" || movement.get("referenceId")!==order.id || movement.get("destinationLocationId")!==destination.id || movement.get("costCorrectionId") || movement.get("reclassificationId") || (await get(`inventoryReversals/${movement.id}`)).exists) fail("Original inventory receipt has changed or been reversed.");
      const entries=await query("inventoryEntries","transactionId",movement.id,4);
      if(entries.length!==2 || entries.some(e=>e.get("organizationId")!==actor.organizationId || e.get("productId")!==product.id || e.get("lotId") || e.get("serializedItemId")) || !entries.some(e=>e.get("locationId")===destination.id && e.get("quantityDelta")===quantity && e.get("valueDeltaMinor")===value && (e.get("managementValueDeltaMinor")??value)===value) || !entries.some(e=>e.get("externalAccount")===`supplier:${oldSupplierId}` && e.get("quantityDelta")===-quantity && e.get("valueDeltaMinor")===-value && (e.get("managementValueDeltaMinor")??-value)===-value)) fail("Original inventory ledger does not balance to the receipt.");
      const destinationBalance=owned(await get(`inventoryBalances/${balanceDocumentId(actor.organizationId,product.id,destination.id)}`));
      if(destinationBalance.get("locationId")!==destination.id || destinationBalance.get("productId")!==product.id || destinationBalance.get("lastTransactionId")!==movement.id || num(destinationBalance.get("onHandQuantity"))<quantity) fail("Destination stock moved after this receipt. Reconcile intervening movements before reclassification.");
      let sourceBalance:DocumentSnapshot|undefined;
      if(choice!.sourceLocationId) {
        sourceBalance=owned(await get(`inventoryBalances/${balanceDocumentId(actor.organizationId,product.id,source.id)}`));
        const onHand=num(sourceBalance.get("onHandQuantity")),company=num(sourceBalance.get("totalValueMinor")),management=num(sourceBalance.get("managementTotalValueMinor")??company);
        if(sourceBalance.get("locationId")!==source.id || sourceBalance.get("productId")!==product.id || optionalNum(sourceBalance,"reservedQuantity") || sourceBalance.get("availableQuantity")!==onHand || onHand<quantity || internalTransferMovementValue(company,onHand,quantity)!==value || internalTransferMovementValue(management,onHand,quantity)!==value) fail("Source stock is reserved, insufficient or has a different exact company/management issue value.");
        const history=await tx.get(db.collection("inventoryEntries").where("locationId","==",source.id).where("productId","==",product.id).limit(201));
        if(history.size===201 || history.empty) fail("Source ledger history is incomplete or exceeds the bounded review."); history.docs.forEach(remember);
        if(history.docs.some(e=>e.get("organizationId")!==actor.organizationId || Number(e.get("quantityDelta"))<0)) fail("Source has historical outgoing movements. This bounded correction requires a separately reviewed source-issue reconciliation.");
        // Negative quantities fail numeric validation above. This conservative v1
        // refuses ANY historical source issue, rather than trusting a confirmation.
        if(history.docs.reduce((s,e)=>s+num(e.get("quantityDelta")),0)!==onHand || history.docs.reduce((s,e)=>s+num(e.get("valueDeltaMinor")),0)!==company || history.docs.reduce((s,e)=>s+num(e.get("managementValueDeltaMinor")??e.get("valueDeltaMinor")),0)!==management) fail("Source ledger does not reconcile to its balance.");
      }
      lines.push({line,item,receipt,movement,product,invoice,quantity,value,...(sourceBalance?{source,sourceBalance}:{}),...(choice!.externalSupplierId?{externalSupplierId:choice!.externalSupplierId}:{})});
      mapped.push({id:line.id,productId:product.id,trackingType:"quantity",quantity,unitCostMinor:unitCost,receivedQuantity:quantity,invoicedQuantity:quantity,vatMinor:0,receiptId:receipt.id,inventoryTransactionId:movement.id,disposition:sourceBalance?"internal":"external",...(sourceBalance?{source:{locationId:source.id,balanceVersion:num(sourceBalance.get("version")),availableQuantity:num(sourceBalance.get("availableQuantity")),unitCostMinor:unitCost,managementUnitCostMinor:unitCost,alreadyIssued:false}}:{externalSupplierId:choice!.externalSupplierId})});
    }
    evidence.invoices.push({id:invoice.id,purchaseOrderId:order.id,purchaseOrderNumber:String(order.get("purchaseOrderNumber")),organizationId:actor.organizationId,destinationLocationId:destination.id,supplierId:oldSupplierId,status:"approved",netMinor:net,vatMinor:0,grossMinor:net,paidMinor:0,creditedMinor:0,outstandingMinor:net,journalId:journal.id,journalPosted:true,journalReversed:false,periodOpen:true,lines:mapped});
  }
  const plan=planPurchaseReclassification(evidence);
  if(plan.blockers.length) fail(plan.blockers.join(" "));
  if(num(oldSupplier.get("outstandingBalanceMinor"))<plan.originalPayableMinor) fail("Head Office supplier balance is smaller than the invoices being reversed.");
  const internalBalance=await get(`internalTradeBalances/${internalTradeBalanceId(actor.organizationId,headOfficeBranchId,destinationId)}`);
  if(internalBalance.exists && (internalBalance.get("organizationId")!==actor.organizationId || internalBalance.get("branchId")!==destinationId || internalBalance.get("headOfficeBranchId")!==headOfficeBranchId || num(internalBalance.get("invoicedMinor"))-num(internalBalance.get("paidMinor"))-num(internalBalance.get("returnedMinor"))!==internalBalance.get("balanceMinor"))) fail("Internal trading balance requires review.");
  const fingerprint=requestFingerprint({selection:input,evidence:evidenceRows.sort((a,b)=>String(a.path).localeCompare(String(b.path)))});
  return {plan,fingerprint,invoices,orders,lines,counter,oldSupplier,externalSuppliers,destination,source,destinationId,headOfficeBranchId,headOffice,internalBalance};
}
export async function previewPurchaseReclassification(actor:ProcurementAccess,input:ReclassificationSelection) {
  authorize(actor);
  return db.runTransaction(async tx=>{const state=await prepare(tx,actor,input,Timestamp.now());return {evidenceFingerprint:state.fingerprint,plan:state.plan,requiresExecutionConfirmation:true};});
}
export async function executePurchaseReclassification(actor:ProcurementAccess,input:ReclassificationExecutionInput) {
  authorize(actor); selection(input);
  if(!/^[0-9a-f]{64}$/.test(input.expectedEvidenceFingerprint) || !/^[0-9a-f-]{36}$/i.test(input.idempotencyKey) || typeof input.reason!=="string" || input.reason.trim().length<10 || input.reason.length>500) fail("A reviewed evidence fingerprint, unique retry reference and correction reason are required.");
  const selected:ReclassificationSelection={supplierInvoiceIds:input.supplierInvoiceIds,lines:input.lines,confirmedZeroTransport:true,confirmedSourceNotPreviouslyIssued:true};
  const key=uniquenessDocumentId(actor.organizationId,"purchase-reclassification",...input.supplierInvoiceIds.slice().sort());
  const correctionRef=db.doc(`purchaseReclassifications/${key}`),operation=db.doc(`idempotencyKeys/${actor.organizationId}_purchaseReclassification_${input.idempotencyKey}`);
  const fingerprint=requestFingerprint({...input,actorUserId:actor.userId}),effectiveAt=Timestamp.now();
  return db.runTransaction(async tx=>{
    const [prior,correction]=await tx.getAll(operation,correctionRef);
    if(prior!.exists) { if(prior!.get("requestFingerprint")!==fingerprint || prior!.get("createdBy")!==actor.userId) fail("This retry reference belongs to different correction instructions."); return {...prior!.get("result"),posted:false}; }
    if(correction!.exists) fail("This batch already has a correction. Do not reclassify or receive it again.");
    const s=await prepare(tx,actor,selected,effectiveAt);
    if(s.fingerprint!==input.expectedEvidenceFingerprint) fail("Evidence changed after preview. Review a fresh correction preview before posting.");
    // Every read above completes before the first write. All stock, accounting,
    // source provenance, replacement invoices and retry evidence commit together.
    const now=FieldValue.serverTimestamp(),iso=effectiveAt.toDate().toISOString(),transferId=`reclass-${key}`;
    let sequence=optionalNum(s.counter,"value"),supplierBalance=num(s.oldSupplier.get("outstandingBalanceMinor"));
    const replacementIds:string[]=[],journalIds:string[]=[];
    for(const invoice of s.invoices) {
      const journal=db.doc(`journalEntries/${uniquenessDocumentId(key,"reverse",invoice.id)}`),amount=num(invoice.get("grossAmountMinor"));
      writeJournal(tx,actor,{journal,manageAccounts:false,journalCounter:s.counter.ref,journalCounterValue:++sequence,journalType:"purchase_reclassification_reversal",referenceType:"purchaseReclassification",referenceId:key,referenceNumber:String(invoice.get("supplierInvoiceNumber")),description:input.reason,branchId:s.destinationId,effectiveAt,lines:[{accountCode:"2000",debitMinor:amount,creditMinor:0},{accountCode:"1200",debitMinor:0,creditMinor:amount}],details:{originalJournalEntryId:invoice.get("journalEntryId"),originalSupplierInvoiceId:invoice.id,nonCash:true}});
      journalIds.push(journal.id); supplierBalance-=amount;
      tx.update(db.doc(`journalEntries/${invoice.get("journalEntryId")}`),{reversalJournalEntryId:journal.id,reclassificationId:key});
      tx.update(invoice.ref,{status:"void",outstandingAmountMinor:0,reclassificationId:key,reclassificationOriginalOutstandingMinor:amount,reversalJournalEntryId:journal.id,updatedAt:now});
      tx.create(db.doc(`supplierAccountEntries/${uniquenessDocumentId(key,"supplier-reversal",invoice.id)}`),{organizationId:actor.organizationId,supplierId:s.oldSupplier.id,branchId:s.destinationId,entryType:"purchase_reclassification",referenceType:"purchaseReclassification",referenceId:key,originalSupplierInvoiceId:invoice.id,amountMinor:-amount,balanceAfterMinor:supplierBalance,journalEntryId:journal.id,effectiveAt,currency:"NGN",createdAt:now,createdBy:actor.userId});
    }
    tx.update(s.oldSupplier.ref,{outstandingBalanceMinor:supplierBalance,updatedAt:now,updatedBy:actor.userId});
    const supplierBalances=new Map(s.externalSuppliers.map(d=>[d.id,num(d.get("outstandingBalanceMinor")??0)]));
    for(const replacement of s.plan.replacementExternalInvoices) {
      const original=s.invoices.find(i=>i.id===replacement.originalInvoiceId)!,supplier=s.externalSuppliers.find(d=>d.id===replacement.supplierId)!;
      const ref=db.doc(`supplierInvoices/${uniquenessDocumentId(key,"external",original.id,supplier.id)}`),journal=db.doc(`journalEntries/${uniquenessDocumentId(key,"external-journal",original.id,supplier.id)}`);
      const number=`COR-${original.id.slice(0,12)}-${ref.id.slice(0,8)}`;
      const journalNumber=writeJournal(tx,actor,{journal,manageAccounts:false,journalCounter:s.counter.ref,journalCounterValue:++sequence,journalType:"supplier_invoice",referenceType:"supplierInvoice",referenceId:ref.id,referenceNumber:number,description:`Corrected external purchase: ${input.reason}`,branchId:s.destinationId,effectiveAt,lines:[{accountCode:"1200",debitMinor:replacement.netMinor,creditMinor:0},{accountCode:"2000",debitMinor:0,creditMinor:replacement.netMinor}],details:{reclassificationId:key,originalSupplierInvoiceId:original.id,stockAlreadyReceived:true}});
      tx.create(ref,clean({...original.data(),supplierId:supplier.id,supplierNumber:supplier.get("supplierNumber"),supplierName:supplier.get("name"),supplierInvoiceNumber:number,status:"approved",invoiceDate:iso.slice(0,10),netAmountMinor:replacement.netMinor,vatAmountMinor:0,grossAmountMinor:replacement.netMinor,outstandingAmountMinor:replacement.netMinor,paidAmountMinor:0,creditedAmountMinor:0,journalEntryId:journal.id,journalNumber,reclassificationId:key,reclassificationReplacement:true,originalSupplierInvoiceId:original.id,returnsRequireReconciliation:true,createdBy:actor.userId,approvedBy:actor.userId,createdAt:now,approvedAt:now,updatedAt:now}));
      tx.create(db.doc(`supplierInvoiceCodes/${uniquenessDocumentId(actor.organizationId,supplier.id,normalizeInventoryIdentifier(number))}`),{organizationId:actor.organizationId,supplierId:supplier.id,supplierInvoiceId:ref.id,normalizedInvoiceNumber:normalizeInventoryIdentifier(number),createdAt:now});
      for(const lineId of replacement.lineIds) {const line=s.lines.find(l=>l.line.id===lineId)!;tx.create(db.doc(`supplierInvoiceItems/${uniquenessDocumentId(key,"external-line",lineId)}`),{...line.line.data(),supplierInvoiceId:ref.id,reclassificationId:key,originalSupplierInvoiceItemId:lineId,originalReceiptId:line.receipt.id,createdAt:now});}
      const balance=num(supplierBalances.get(supplier.id)!+replacement.netMinor); supplierBalances.set(supplier.id,balance);
      tx.create(db.doc(`supplierAccountEntries/${uniquenessDocumentId(key,"external-account",ref.id)}`),{organizationId:actor.organizationId,supplierId:supplier.id,branchId:s.destinationId,entryType:"supplier_invoice",referenceType:"supplierInvoice",referenceId:ref.id,referenceNumber:number,amountMinor:replacement.netMinor,balanceAfterMinor:balance,journalEntryId:journal.id,effectiveAt,createdAt:now,createdBy:actor.userId,currency:"NGN"});
      replacementIds.push(ref.id);journalIds.push(journal.id);
    }
    for(const supplier of s.externalSuppliers) tx.update(supplier.ref,{outstandingBalanceMinor:supplierBalances.get(supplier.id),updatedAt:now,updatedBy:actor.userId});
    const internalLines=s.lines.filter(l=>l.sourceBalance),transferLines=internalLines.map(l=>({id:l.line.id,productId:l.product.id,productName:l.product.get("name"),sku:l.product.get("sku"),trackingType:"quantity",serialItemIds:[],requested:l.quantity,approved:l.quantity,received:l.quantity,damaged:0,cancelled:0,writtenOff:0}));
    const internalInvoiceLines=transferLines.map(l=>({...l,unitPriceMinor:num(s.lines.find(row=>row.line.id===l.id)!.line.get("unitCostMinor")),receivedQuantity:l.received,returnedQuantity:0,returnedSerialItemIds:[],damagedQuantity:0,pendingDamagedQuantity:0,chargedDamagedQuantity:0,waivedDamagedQuantity:0,damagedSerialItemIds:[]}));
    const receiptLines:Record<string,unknown>[]=[];
    for(const line of internalLines) {
      const balance=line.sourceBalance!,quantity=num(balance.get("onHandQuantity")),value=num(balance.get("totalValueMinor")),management=num(balance.get("managementTotalValueMinor")??value),movementId=uniquenessDocumentId(key,"source",line.line.id),number=`RCL-${movementId.slice(0,12)}`;
      tx.update(balance.ref,{onHandQuantity:quantity-line.quantity,availableQuantity:quantity-line.quantity,totalValueMinor:value-line.value,managementTotalValueMinor:management-line.value,averageUnitCostMinor:quantity===line.quantity?0:Math.round((value-line.value)/(quantity-line.quantity)),version:num(balance.get("version"))+1,lastTransactionId:movementId,lastMovementAt:effectiveAt,updatedAt:now});
      tx.create(db.doc(`inventoryTransactions/${movementId}`),clean({organizationId:actor.organizationId,transactionNumber:number,transactionType:"purchase_reclassification",status:"posted",sourceLocationId:s.source.id,sourceBranchId:s.source.get("branchId"),sourceWarehouseId:s.source.get("warehouseId"),transferId,...scope(s.source),referenceType:"purchaseReclassification",referenceId:key,reclassificationId:key,internalTradeInvoiceId:transferId,originalInventoryTransactionId:line.movement.id,originalReceiptId:line.receipt.id,effectiveAt,postedAt:now,createdAt:now,createdBy:actor.userId,postedBy:actor.userId,reason:input.reason,nonCash:true,destinationStockUnchanged:true}));
      const base={organizationId:actor.organizationId,transactionId:movementId,transactionNumber:number,transactionType:"purchase_reclassification",productId:line.product.id,sku:line.product.get("sku"),productName:line.product.get("name"),...(line.product.get("categoryId")?{categoryId:line.product.get("categoryId")} : {}),...(line.product.get("brand")?{brand:line.product.get("brand")} : {}),trackingType:"quantity",currency:"NGN",effectiveAt,createdAt:now,postedBy:actor.userId,reason:input.reason,reclassificationId:key};
      tx.create(db.doc(`inventoryEntries/${uniquenessDocumentId(key,"source-entry",line.line.id)}`),{...base,...scope(s.source),locationId:s.source.id,quantityDelta:-line.quantity,valueDeltaMinor:-line.value,managementValueDeltaMinor:-line.value,unitCostMinor:num(line.line.get("unitCostMinor")),balanceBefore:quantity,balanceAfter:quantity-line.quantity});
      tx.create(db.doc(`inventoryEntries/${uniquenessDocumentId(key,"supplier-counterpart",line.line.id)}`),{...base,externalAccount:`supplier:${s.oldSupplier.id}`,quantityDelta:line.quantity,valueDeltaMinor:line.value,managementValueDeltaMinor:line.value,unitCostMinor:num(line.line.get("unitCostMinor")),balanceBefore:0,balanceAfter:0});
      receiptLines.push({lineId:line.line.id,productId:line.product.id,transactionId:movementId,originalInventoryTransactionId:line.movement.id,originalReceiptId:line.receipt.id,quantity:line.quantity,received:line.quantity,damaged:0,unitPriceMinor:num(line.line.get("unitCostMinor")),amountMinor:line.value,companyReceivedValueMinor:line.value,managementReceivedValueMinor:line.value,companyDamagedValueMinor:0,managementDamagedValueMinor:0,transportMinor:0,serialItemIds:[],damagedSerialItemIds:[]});
    }
    // Correct only the external counterpart attribution for actual purchases.
    // Original destination receipt entries and all location balances stay intact.
    for(const line of s.lines.filter(l=>l.externalSupplierId)) {
      const movementId=uniquenessDocumentId(key,"external-stock-provenance",line.line.id),number=`RCL-${movementId.slice(0,12)}`;
      tx.create(db.doc(`inventoryTransactions/${movementId}`),{organizationId:actor.organizationId,transactionNumber:number,transactionType:"purchase_reclassification",status:"posted",branchId:s.destinationId,destinationBranchId:s.destinationId,referenceType:"purchaseReclassification",referenceId:key,reclassificationId:key,originalInventoryTransactionId:line.movement.id,originalReceiptId:line.receipt.id,effectiveAt,postedAt:now,createdAt:now,createdBy:actor.userId,postedBy:actor.userId,reason:input.reason,destinationStockUnchanged:true,nonCash:true});
      const base={organizationId:actor.organizationId,transactionId:movementId,transactionNumber:number,transactionType:"purchase_reclassification",productId:line.product.id,sku:line.product.get("sku"),productName:line.product.get("name"),...(line.product.get("categoryId")?{categoryId:line.product.get("categoryId")} : {}),...(line.product.get("brand")?{brand:line.product.get("brand")} : {}),trackingType:"quantity",currency:"NGN",effectiveAt,createdAt:now,postedBy:actor.userId,reason:input.reason,reclassificationId:key,unitCostMinor:num(line.line.get("unitCostMinor")),balanceBefore:0,balanceAfter:0};
      tx.create(db.doc(`inventoryEntries/${uniquenessDocumentId(key,"external-stock-old",line.line.id)}`),{...base,externalAccount:`supplier:${s.oldSupplier.id}`,quantityDelta:line.quantity,valueDeltaMinor:line.value,managementValueDeltaMinor:line.value});
      tx.create(db.doc(`inventoryEntries/${uniquenessDocumentId(key,"external-stock-new",line.line.id)}`),{...base,externalAccount:`supplier:${line.externalSupplierId}`,quantityDelta:-line.quantity,valueDeltaMinor:-line.value,managementValueDeltaMinor:-line.value});
    }
    const shared=clean({organizationId:actor.organizationId,sourceLocationId:s.source.id,destinationLocationId:s.destination.id,sourceBranchId:s.source.get("branchId"),sourceWarehouseId:s.source.get("warehouseId"),reclassificationId:key,returnsRequireReconciliation:true});
    tx.create(db.doc(`stockTransfers/${transferId}`),{...shared,id:transferId,number:`RCL-${key.slice(0,12)}`,destinationBranchId:s.destinationId,sourceName:s.source.get("name"),destinationName:s.destination.get("name"),status:"completed",version:1,items:transferLines,tradeAgreement:{version:1,headOfficeBranchId:s.headOfficeBranchId,headOfficeBranchName:s.headOffice.get("name"),pricingStatus:"priced",pricesByLineId:Object.fromEntries(internalLines.map(l=>[l.line.id,l.line.get("unitCostMinor")])),managementCostVersion:1,pricedBy:actor.userId,pricedAt:iso},note:input.reason,problemNote:"",createdBy:actor.userId,approvedBy:actor.userId,createdAt:iso,updatedAt:iso});
    tx.create(db.doc(`internalTradeInvoices/${transferId}`),{...shared,id:transferId,transferId,number:`IT-RCL-${key.slice(0,12)}`,branchId:s.destinationId,branchName:s.destination.get("name"),headOfficeBranchId:s.headOfficeBranchId,headOfficeBranchName:s.headOffice.get("name"),managementCostVersion:1,transportMinor:0,totalMinor:s.plan.internalTransferMinor,paidMinor:0,returnedMinor:0,balanceMinor:s.plan.internalTransferMinor,version:1,currency:"NGN",lines:internalInvoiceLines,createdAt:iso,updatedAt:iso});
    const old=s.internalBalance;tx.set(old.ref,{...(old.data()??{}),organizationId:actor.organizationId,branchId:s.destinationId,headOfficeBranchId:s.headOfficeBranchId,invoicedMinor:optionalNum(old,"invoicedMinor")+s.plan.internalTransferMinor,paidMinor:optionalNum(old,"paidMinor"),returnedMinor:optionalNum(old,"returnedMinor"),balanceMinor:optionalNum(old,"balanceMinor")+s.plan.internalTransferMinor,version:optionalNum(old,"version")+1,updatedAt:iso});
    tx.create(db.doc(`internalTradeEntries/${transferId}_000000000001`),{organizationId:actor.organizationId,branchId:s.destinationId,headOfficeBranchId:s.headOfficeBranchId,invoiceId:transferId,transferId,kind:"invoice",receiptLines,inventoryTransactionIds:receiptLines.map(r=>r.transactionId),amountMinor:s.plan.internalTransferMinor,signedAmountMinor:s.plan.internalTransferMinor,actorUserId:actor.userId,createdAt:iso,idempotencyKey:input.idempotencyKey,reclassificationId:key,transportMinor:0,sourceFreightMinor:0});
    for(const order of s.orders) tx.update(order.ref,{reclassificationId:key,reclassificationOriginalSupplierId:s.oldSupplier.id,updatedAt:now});
    for(const line of s.lines) {tx.update(line.receipt.ref,{reclassificationId:key});tx.update(line.movement.ref,{reclassificationId:key});}
    const result={correctionId:key,posted:true,replacementExternalInvoiceIds:replacementIds,internalTransferId:transferId,originalInvoiceIds:s.invoices.map(i=>i.id),destinationQuantityDelta:0};
    tx.create(correctionRef,{organizationId:actor.organizationId,createdBy:actor.userId,createdAt:now,reason:input.reason,requestFingerprint:fingerprint,evidenceFingerprint:s.fingerprint,plan:s.plan,result,originalInvoiceIds:result.originalInvoiceIds,journalEntryIds:journalIds,sourceIssueQuantity:internalLines.reduce((sum,line)=>sum+line.quantity,0),destinationQuantityDelta:0,executionVersion:1,status:"posted"});
    tx.create(operation,{organizationId:actor.organizationId,createdBy:actor.userId,createdAt:now,requestFingerprint:fingerprint,result});
    writeAuditLog(tx,actor,{action:"purchase.reclassified",entityType:"purchaseReclassification",entityId:key,correlationId:input.idempotencyKey,sourceFunction:"approveSupplierInvoice",reason:input.reason,before:{originalInvoiceIds:result.originalInvoiceIds,originalPayableMinor:s.plan.originalPayableMinor},after:{...result,externalPurchaseMinor:s.plan.externalPurchaseMinor,internalTransferMinor:s.plan.internalTransferMinor,sourceLocationId:s.source.id,branchId:s.destinationId,nonCash:true}});
    return result;
  });
}

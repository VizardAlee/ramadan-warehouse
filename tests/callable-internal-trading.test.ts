import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { balanceDocumentId, uniquenessDocumentId } from "../functions/src/inventory/calculations";
import { internalTradeBalanceId } from "../functions/src/branch-trading/identity";
import type { StockTransfer } from "../functions/src/transfers/simple-model";
import type { InternalTradeInvoice, InternalTradeWorkspace } from "../functions/src/branch-trading/model";
import { call, setupTransferHarness, type TestActor, type TransferHarness } from "./helpers/transfer-workflow";
let h:TransferHarness;
const key=()=>crypto.randomUUID();
const hqContext = {type: "warehouse", id: "internal-trade-warehouse"};
const branchContext = {type: "branch", id: "internal-trade-branch"};
const api=<T=Record<string,unknown>>(actor:TestActor,input:object)=>call<T>(actor,"stockTransfers",JSON.parse(JSON.stringify(input)));
const transfer=async(id:string)=>(await h.db.doc(`stockTransfers/${id}`).get()).data() as StockTransfer;
const invoice=async(id:string)=>(await h.db.doc(`internalTradeInvoices/${id}`).get()).data() as InternalTradeInvoice;
const stock=async(locationId:string)=>(await h.db.doc(`inventoryBalances/${balanceDocumentId(h.organizationId,h.productId,locationId)}`).get()).data()!;
const create=async(qty=4)=> (await api<{transferId:string}>(h.receiver,{action:"create",sourceLocationId:h.originLocationId,destinationLocationId:h.destinationLocationId,items:[{productId:h.productId,quantity:qty}],idempotencyKey:key()})).transferId;
const price=async(id:string,actor=h.creator,value=15000)=>{const t=await transfer(id);return api(actor,{action:"price",transferId:id,version:t.version,lines:t.items.map(l=>({id:l.id,unitPriceMinor:value})),idempotencyKey:key()});};
const approve=async(id:string)=>{const t=await transfer(id);return api(h.creator,{action:"approve",transferId:id,version:t.version,lines:t.items.map(l=>({id:l.id,quantity:l.requested})),idempotencyKey:key()});};
const receiptInput=async(id:string,qty:number,damaged=0)=>{const t=await transfer(id);return {action:"receive",transferId:id,version:t.version,lines:t.items.map(l=>({id:l.id,received:qty,damaged})),idempotencyKey:key()};};
const cash=(invoiceId:string,amountMinor:number)=>({action:"record_payment",invoiceId,amountMinor,sourceMethod:"cash",destinationMethod:"cash",paymentDate:new Date().toISOString(),confirmedCompleted:true,reference:"Cash physically delivered to HQ",idempotencyKey:key()});
let oldId:string, id:string;
beforeAll(async()=>{
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error("Isolated emulators required");
  h=await setupTransferHarness({suffix:"internal-trade",openingQuantity:500});
  oldId=await create(2);
  await h.db.doc("branches/internal-trade-hq").set({organizationId:h.organizationId,name:"Head office",status:"active",branchType:"head_office"});
  await h.db.doc(`organizations/${h.organizationId}`).update({headOfficeBranchId:"internal-trade-hq",headOfficeSupplyWarehouseId:"internal-trade-warehouse"});
},180000);
afterAll(async()=>h?.cleanup());
describe.sequential("HQ internal trading",()=>{
  it("keeps preexisting unreceived transfers nonfinancial",async()=>{
    await approve(oldId);await api(h.receiver,await receiptInput(oldId,2));
    expect((await h.db.doc(`internalTradeInvoices/${oldId}`).get()).exists).toBe(false);
  });
  it("requires administrator pricing prospectively and creates no invoice before receipt",async()=>{
    id=await create();expect((await transfer(id)).tradeAgreement?.pricingStatus).toBe("required");
    await expect(approve(id)).rejects.toThrow();await expect(price(id,h.receiver)).rejects.toThrow();
    await price(id);await approve(id);await expect(price(id)).rejects.toThrow();
    expect((await h.db.doc(`internalTradeInvoices/${id}`).get()).exists).toBe(false);
  });
  it("posts partial receipt and internal invoice atomically exactly once, preserving company cost",async()=>{
    const beforeSource=await stock(h.originLocationId),beforeBranch=await stock(h.destinationLocationId);
    const input=await receiptInput(id,2);await api(h.receiver,input);expect((await api(h.receiver,input)).repeated).toBe(true);
    const doc=await invoice(id);expect(doc.totalMinor).toBe(30000);expect(doc.balanceMinor).toBe(30000);expect(doc.lines[0]!.receivedQuantity).toBe(2);
    const afterSource=await stock(h.originLocationId),afterBranch=await stock(h.destinationLocationId);
    expect(afterSource.totalValueMinor+afterBranch.totalValueMinor).toBe(beforeSource.totalValueMinor+beforeBranch.totalValueMinor);
    expect(afterBranch.totalValueMinor-beforeBranch.totalValueMinor).toBe(20000);
  });
  it("exposes scoped internal balances without company costs",async()=>{
    const result=await api<InternalTradeWorkspace>(h.receiver,{action:"trading_workspace",invoiceId:id});
    expect(result.invoices.map(i=>i.id)).toEqual([id]);expect(result.canRecordPayment).toBe(false);expect(result.canPrice).toBe(false);expect(result.balances[0]!.balanceMinor).toBe(30000);
    expect(JSON.stringify(result)).not.toContain("unitCostMinor");
    const foreign=await api<InternalTradeWorkspace>(h.foreign,{action:"trading_workspace",invoiceId:id});expect(foreign.invoices).toEqual([]);
  });
  it("rejects unauthorized payment, locks, and overpayment without posting money",async()=>{
    await expect(api(h.receiver,cash(id,100))).rejects.toThrow();await expect(api(h.creator,cash(id,30001))).rejects.toThrow();
    const period= new Date().toISOString().slice(0,7),ref=h.db.doc(`accountingPeriods/${uniquenessDocumentId(h.organizationId,period)}`);
    await ref.set({organizationId:h.organizationId,status:"closed",periodKey:period});
    await expect(api(h.creator,cash(id,100))).rejects.toThrow();await expect(api(h.receiver,await receiptInput(id,1))).rejects.toThrow();
    await ref.delete();expect((await invoice(id)).totalMinor).toBe(30000);
  });
  it("records completed cash through paired clearing journals and settles invoice once",async()=>{
    const input=cash(id,10000);const result=await api(h.creator,input);await api(h.creator,input);
    expect((await invoice(id)).paidMinor).toBe(10000);expect((await invoice(id)).balanceMinor).toBe(20000);
    const journals=await h.db.collection("journalEntries").where("referenceId","==",result.journalEntryId).get();expect(journals.size).toBe(2);
    expect(journals.docs.every(d=>d.get("journalType")==="internal_funds_transfer")).toBe(true);
    await expect(api(h.creator,{...input,amountMinor:9000})).rejects.toThrow();
    await expect(api(h.creator,{...cash(id,1000),existingFundsTransferId:result.journalEntryId,paymentDate:input.paymentDate})).rejects.toThrow();
  });
  it("adds later receipts at snapshotted prices without duplicating prior invoices",async()=>{
    await api(h.receiver,await receiptInput(id,2));const doc=await invoice(id);expect(doc.totalMinor).toBe(60000);expect(doc.paidMinor).toBe(10000);expect(doc.lines[0]!.receivedQuantity).toBe(4);
  });
  it("returns physical goods once, credits invoice, and preserves company inventory value",async()=>{
    const doc=await invoice(id),beforeSource=await stock(h.originLocationId),beforeBranch=await stock(h.destinationLocationId);
    const input={action:"return_goods",operatingContext:hqContext,confirmedReceived:true,confirmedResellable:true,invoiceId:id,lines:[{id:doc.lines[0]!.id,quantity:1}],note:"One unit physically received back by HQ",idempotencyKey:key()};
    await expect(api(h.receiver,{...input,operatingContext:branchContext})).rejects.toThrow();
    const period = new Date().toISOString().slice(0, 7);
    const periodRef = h.db.doc(`accountingPeriods/${uniquenessDocumentId(h.organizationId, period)}`);
    await periodRef.set({organizationId:h.organizationId,status:"closed",periodKey:period});
    try {
      await expect(api(h.creator,input)).rejects.toMatchObject({code:"functions/failed-precondition"});
      expect((await invoice(id)).returnedMinor).toBe(0);
      expect(await stock(h.originLocationId)).toEqual(beforeSource);
      expect(await stock(h.destinationLocationId)).toEqual(beforeBranch);
    } finally { await periodRef.delete(); }
    const result=await api(h.creator,input);await api(h.creator,input);
    expect(result.amountMinor).toBe(15000);expect((await invoice(id)).returnedMinor).toBe(15000);expect((await invoice(id)).balanceMinor).toBe(35000);
    const afterSource=await stock(h.originLocationId),afterBranch=await stock(h.destinationLocationId);
    expect(afterSource.totalValueMinor+afterBranch.totalValueMinor).toBe(beforeSource.totalValueMinor+beforeBranch.totalValueMinor);
    expect(afterSource.onHandQuantity-beforeSource.onHandQuantity).toBe(1);
    await expect(api(h.creator,{...input,lines:[{id:doc.lines[0]!.id,quantity:4}],idempotencyKey:key()})).rejects.toThrow();
  });
  it("supports branch credit after fully paid goods are returned",async()=>{
    await api(h.creator,cash(id,35000));const doc=await invoice(id);
    await api(h.creator,{action:"return_goods",operatingContext:hqContext,confirmedReceived:true,confirmedResellable:true,invoiceId:id,lines:[{id:doc.lines[0]!.id,quantity:1}],note:"Paid unit received back by HQ",idempotencyKey:key()});
    expect((await invoice(id)).balanceMinor).toBe(-15000);
  });
  it("holds damaged-only receipts in a closed period until explicit admin charge or no-charge review", async () => {
    // A separate final transfer keeps the earlier exact receipt/payment assertions stable.
    const originalInvoice = await invoice(id);
    const damagedId = await create(3);
    await price(damagedId); await approve(damagedId);
    const balanceRef = h.db.doc(`internalTradeBalances/${internalTradeBalanceId(h.organizationId, "internal-trade-hq", "internal-trade-branch")}`);
    const aggregateBefore = (await balanceRef.get()).data()!;
    const branchBefore = await stock(h.destinationLocationId);
    const sourceBefore = await stock(h.originLocationId);
    const period = new Date().toISOString().slice(0, 7);
    const periodRef = h.db.doc(`accountingPeriods/${uniquenessDocumentId(h.organizationId, period)}`);
    const received = {...await receiptInput(damagedId, 0, 3), operatingContext:branchContext};
    let pending!: InternalTradeInvoice;
    await periodRef.set({organizationId:h.organizationId,status:"closed",periodKey:period});
    try {
      await api(h.receiver, received);
      expect((await api(h.receiver, received)).repeated).toBe(true);
      pending = await invoice(damagedId);
      expect(pending).toMatchObject({totalMinor:0,balanceMinor:0,paidMinor:0,returnedMinor:0});
      expect(pending.lines[0]).toMatchObject({receivedQuantity:0,damagedQuantity:3,pendingDamagedQuantity:3,chargedDamagedQuantity:0,waivedDamagedQuantity:0});
      expect((await transfer(damagedId)).items[0]).toMatchObject({received:0,damaged:3});
      expect((await stock(h.originLocationId)).onHandQuantity).toBe(sourceBefore.onHandQuantity - 3);
      expect((await stock(h.destinationLocationId)).onHandQuantity).toBe(branchBefore.onHandQuantity);
      const quarantine = await stock("simple_damaged_internal-trade-branch");
      expect(quarantine.onHandQuantity).toBe(3);
      expect(quarantine.totalValueMinor).toBe(30000);
      expect((await balanceRef.get()).get("balanceMinor")).toBe(aggregateBefore.balanceMinor);
      const held = await h.db.collection("internalTradeEntries").where("invoiceId", "==", damagedId).get();
      expect(held.size).toBe(1);
      expect(held.docs[0]!.data()).toMatchObject({kind:"damage_hold",amountMinor:0,signedAmountMinor:0});
      const review = {action:"review_damage",operatingContext:hqContext,invoiceId:damagedId,version:pending.version,decision:"charge",lines:[{id:pending.lines[0]!.id,quantity:1}],note:"Reviewed damaged arrival; branch responsibility confirmed",idempotencyKey:key()};
      await expect(api(h.receiver,{...review,operatingContext:branchContext})).rejects.toMatchObject({code:"functions/permission-denied"});
      await expect(api(h.creator,{...review,note:""})).rejects.toMatchObject({code:"functions/invalid-argument"});
      await expect(api(h.creator,review)).rejects.toMatchObject({code:"functions/failed-precondition"});
      expect(await invoice(damagedId)).toEqual(pending);
      expect((await h.db.collection("internalTradeDamageReviews").where("invoiceId", "==", damagedId).get()).empty).toBe(true);
      const waiver = {...review,decision:"no_charge",note:"Reviewed arrival evidence; one unit not chargeable to branch",idempotencyKey:key()};
      const result = await api(h.creator,waiver);
      expect(result.amountMinor).toBe(0);
      expect((await api(h.creator,waiver)).repeated).toBe(true);
      expect((await invoice(damagedId)).lines[0]).toMatchObject({pendingDamagedQuantity:2,chargedDamagedQuantity:0,waivedDamagedQuantity:1});
      expect((await invoice(damagedId)).balanceMinor).toBe(0);
      expect((await balanceRef.get()).get("balanceMinor")).toBe(aggregateBefore.balanceMinor);
      expect((await h.db.doc(`internalTradeDamageReviews/${String(result.reviewId)}`).get()).data()).toMatchObject({decision:"no_charge",note:waiver.note,amountMinor:0,actorUserId:h.creator.uid});
    } finally { await periodRef.delete(); }

    const afterWaiver = await invoice(damagedId);
    const beforeReviewStock = await Promise.all([stock(h.originLocationId),stock(h.destinationLocationId),stock("simple_damaged_internal-trade-branch")]);
    const beforeJournals = await h.db.collection("journalEntries").where("organizationId", "==", h.organizationId).get();
    const charge = {action:"review_damage",operatingContext:hqContext,invoiceId:damagedId,version:afterWaiver.version,decision:"charge",lines:[{id:afterWaiver.lines[0]!.id,quantity:2}],note:"Admin reviewed remaining two damaged units and approved original-price charge",idempotencyKey:key()};
    const result = await api(h.creator,charge);
    expect(result.amountMinor).toBe(30000);
    expect((await api(h.creator,charge)).repeated).toBe(true);
    await expect(api(h.creator,{...charge,decision:"no_charge"})).rejects.toMatchObject({code:"functions/already-exists"});
    const reviewed = await invoice(damagedId);
    expect(reviewed).toMatchObject({totalMinor:30000,balanceMinor:30000});
    expect(reviewed.lines[0]).toMatchObject({receivedQuantity:0,pendingDamagedQuantity:0,chargedDamagedQuantity:2,waivedDamagedQuantity:1});
    expect((await balanceRef.get()).get("balanceMinor")).toBe(aggregateBefore.balanceMinor + 30000);
    expect((await h.db.doc(`internalTradeDamageReviews/${String(result.reviewId)}`).get()).data()).toMatchObject({decision:"charge",note:charge.note,amountMinor:30000,actorUserId:h.creator.uid});
    expect((await h.db.doc(`internalTradeEntries/${String(result.entryId)}`).get()).data()).toMatchObject({kind:"damage_charge",amountMinor:30000,signedAmountMinor:30000});
    expect(await Promise.all([stock(h.originLocationId),stock(h.destinationLocationId),stock("simple_damaged_internal-trade-branch")])).toEqual(beforeReviewStock);
    expect((await h.db.collection("journalEntries").where("organizationId", "==", h.organizationId).get()).docs.map(row => row.id)).toEqual(beforeJournals.docs.map(row => row.id));
    expect(await invoice(id)).toEqual(originalInvoice);
  });

});

describe.sequential("all-branch transactional supply", () => {
  const seller = "internal-trade-branch", buyer = "internal-trade-second";
  let tradeId: string;
  it("requires prices for ordinary branch supply and invoices partial receipts once", async () => {
    await h.db.doc(`branches/${buyer}`).set({organizationId:h.organizationId,name:"Second branch",status:"active",branchType:"branch"});
    await h.db.doc(`inventoryLocations/${buyer}`).set({organizationId:h.organizationId,name:"Second stock",status:"active",type:"branch",branchId:buyer});
    tradeId = (await api<{transferId:string}>(h.receiver,{action:"create",sourceLocationId:h.destinationLocationId,destinationLocationId:buyer,items:[{productId:h.productId,quantity:2}],idempotencyKey:key()})).transferId;
    expect((await transfer(tradeId)).tradeAgreement).toMatchObject({headOfficeBranchId:seller,pricingStatus:"required"});
    await expect(approve(tradeId)).rejects.toThrow();
    await price(tradeId); await approve(tradeId);
    const input=await receiptInput(tradeId,1);
    await expect(api(h.receiver,input)).rejects.toMatchObject({code:"functions/permission-denied"});
    await api(h.creator,input); await api(h.creator,input);
    expect(await invoice(tradeId)).toMatchObject({headOfficeBranchId:seller,branchId:buyer,totalMinor:15000,balanceMinor:15000});
  });
  it("shows supplier statements with existing branch read permissions and rejects unrelated scopes", async () => {
    const result=await api<InternalTradeWorkspace>(h.receiver,{action:"trading_workspace",branchId:seller,invoiceId:tradeId});
    expect(result.invoices.map(row=>row.id)).toEqual([tradeId]);
    expect(result.entries).toHaveLength(1);
    expect(result.balances.some(row=>row.branchId===buyer && row.headOfficeBranchId===seller)).toBe(true);
    await expect(api(h.receiver,{action:"trading_workspace",branchId:buyer})).rejects.toMatchObject({code:"functions/permission-denied"});
    expect((await api<InternalTradeWorkspace>(h.foreign,{action:"trading_workspace",invoiceId:tradeId})).invoices).toEqual([]);
  });
  it("keeps selected branch and warehouse invoices and entries isolated without a branch filter", async () => {
    const supplierView = await api<InternalTradeWorkspace>(h.creator,{action:"trading_workspace",operatingContext:{type:"branch",id:seller},invoiceId:tradeId});
    expect(supplierView.invoices.map(row=>row.id)).toEqual([tradeId]);
    expect(supplierView.entries).toHaveLength(1);
    const warehouseView = await api<InternalTradeWorkspace>(h.creator,{action:"trading_workspace",operatingContext:hqContext,invoiceId:tradeId});
    expect(warehouseView.invoices).toEqual([]);expect(warehouseView.entries).toEqual([]);expect(warehouseView.balances).toEqual([]);
    const unrelatedBranch = await api<InternalTradeWorkspace>(h.creator,{action:"trading_workspace",operatingContext:{type:"branch",id:"internal-trade-hq"},invoiceId:tradeId});
    expect(unrelatedBranch.invoices).toEqual([]);expect(unrelatedBranch.entries).toEqual([]);
    expect(unrelatedBranch.balances.every(row=>row.headOfficeBranchId==="internal-trade-hq" || row.branchId==="internal-trade-hq")).toBe(true);
    const originalWarehouse = await api<InternalTradeWorkspace>(h.creator,{action:"trading_workspace",operatingContext:hqContext,invoiceId:id});
    expect(originalWarehouse.invoices.map(row=>row.id)).toEqual([id]);
  });
  it("records completed buyer-to-supplier money without duplicating company cash or revenue", async () => {
    const input=cash(tradeId,10000), result=await api(h.creator,input);
    await api(h.creator,input);
    expect(await invoice(tradeId)).toMatchObject({paidMinor:10000,balanceMinor:5000});
    const journals=await h.db.collection("journalEntries").where("referenceId","==",result.journalEntryId).get();
    expect(journals.size).toBe(2);
    expect(new Set(journals.docs.map(row=>row.get("branchId")))).toEqual(new Set([buyer,seller]));
    expect(journals.docs.every(row=>row.get("details").sourceBranchId===buyer && row.get("details").destinationBranchId===seller)).toBe(true);
    await expect(api(h.creator,cash(tradeId,5001))).rejects.toThrow();
  });
  it("supports later receipt and physical return to the ordinary supplying branch", async () => {
    await api(h.creator,await receiptInput(tradeId,1));
    const inv=await invoice(tradeId);
    const input={action:"return_goods",operatingContext:{type:"branch",id:seller},confirmedReceived:true,confirmedResellable:true,invoiceId:tradeId,lines:[{id:inv.lines[0]!.id,quantity:1}],note:"Received inspected goods back at supplying branch",idempotencyKey:key()};
    await api(h.creator,input); await api(h.creator,input);
    expect(await invoice(tradeId)).toMatchObject({totalMinor:30000,returnedMinor:15000,paidMinor:10000,balanceMinor:5000});
  });
  it("settles bank payments to the actual supplier and rejects a reversed account pair", async () => {
    await h.db.doc("bankAccounts/interbranch-buyer").set({organizationId:h.organizationId,branchId:buyer,active:true,ledgerAccountCode:"1041",bankName:"Test bank",accountName:"Buyer"});
    await h.db.doc("bankAccounts/interbranch-seller").set({organizationId:h.organizationId,branchId:seller,active:true,ledgerAccountCode:"1042",bankName:"Test bank",accountName:"Supplier"});
    const input={...cash(tradeId,5000),sourceMethod:"bank_transfer",destinationMethod:"bank_transfer",sourceBankAccountId:"interbranch-buyer",destinationBankAccountId:"interbranch-seller"};
    await expect(api(h.creator,{...input,sourceBankAccountId:"interbranch-seller",destinationBankAccountId:"interbranch-buyer"})).rejects.toThrow();
    const result=await api(h.creator,input);await api(h.creator,input);
    expect((await invoice(tradeId)).balanceMinor).toBe(0);
    const journals=await h.db.collection("journalEntries").where("referenceId","==",result.journalEntryId).get();
    const lines=(await Promise.all(journals.docs.map(row=>h.db.collection("journalLines").where("journalEntryId","==",row.id).get()))).flatMap(page=>page.docs.map(row=>row.data()));
    expect(lines.every(row=>["1041","1042","1380"].includes(row.accountCode))).toBe(true);
    expect(lines.filter(row=>row.accountCode!=="1380").reduce((sum,row)=>sum+row.debitMinor-row.creditMinor,0)).toBe(0);
    expect(lines.find(row=>row.accountCode==="1041")).toMatchObject({branchId:buyer,creditMinor:5000});
    expect(lines.find(row=>row.accountCode==="1042")).toMatchObject({branchId:seller,debitMinor:5000});
    for (const [accountId, branchId, expected] of [["interbranch-buyer",buyer,-5000],["interbranch-seller",seller,5000]] as const) {
      const workspace=await call<{recordedBalance:{balanceMinor:number};journalLines:{bankAccountId:string}[]}>(h.creator,"getBankReconciliationWorkspace",{bankAccountId:accountId,operatingContext:{type:"branch",id:branchId}});
      expect(workspace.recordedBalance.balanceMinor).toBe(expected);
      expect(workspace.journalLines.some(row=>row.bankAccountId===accountId)).toBe(true);
    }
    await expect(call(h.creator,"getBankReconciliationWorkspace",{bankAccountId:"interbranch-buyer",operatingContext:{type:"branch",id:seller}})).rejects.toThrow();
  });
  it("keeps opposite-direction balances separate and supports ordinary branches supplying HQ", async () => {
    const reverse=(await api<{transferId:string}>(h.creator,{action:"create",sourceLocationId:buyer,destinationLocationId:h.destinationLocationId,items:[{productId:h.productId,quantity:1}],idempotencyKey:key()})).transferId;
    await price(reverse);await approve(reverse);await api(h.receiver,await receiptInput(reverse,1));
    expect(await invoice(reverse)).toMatchObject({branchId:seller,headOfficeBranchId:buyer,balanceMinor:15000});
    expect((await h.db.doc(`internalTradeBalances/${internalTradeBalanceId(h.organizationId,seller,buyer)}`).get()).get("balanceMinor")).toBe(0);
    expect((await h.db.doc(`internalTradeBalances/${internalTradeBalanceId(h.organizationId,buyer,seller)}`).get()).get("balanceMinor")).toBe(15000);
    const hqLocation="internal-trade-hq-store";
    await h.db.doc(`inventoryLocations/${hqLocation}`).set({organizationId:h.organizationId,name:"HQ stock",status:"active",type:"branch",branchId:"internal-trade-hq"});
    const toHq=(await api<{transferId:string}>(h.creator,{action:"create",sourceLocationId:h.destinationLocationId,destinationLocationId:hqLocation,items:[{productId:h.productId,quantity:1}],idempotencyKey:key()})).transferId;
    await price(toHq);await approve(toHq);await api(h.creator,await receiptInput(toHq,1));
    expect(await invoice(toHq)).toMatchObject({branchId:"internal-trade-hq",headOfficeBranchId:seller,balanceMinor:15000});
  });

});

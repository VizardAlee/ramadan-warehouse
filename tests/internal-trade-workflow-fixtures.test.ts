import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessProfile } from "../functions/src/auth/authorize";
import { balanceDocumentId } from "../functions/src/inventory/calculations";
import type { StockTransfer } from "../functions/src/transfers/simple-model";
import type { InternalTradeWorkspace,InternalTradeInvoice } from "../functions/src/branch-trading/model";
import { internalTradeBalanceId } from "../functions/src/branch-trading/identity";
import { uniquenessDocumentId } from "../functions/src/inventory/calculations";
import { TransferFirestoreFixture } from "./helpers/transfer-firestore-fixture";

const state = vi.hoisted(() => ({ db: null as unknown as TransferFirestoreFixture, actor: null as unknown as AccessProfile }));
vi.mock("../functions/src/admin.js", () => ({ db: {
  doc: (path: string) => state.db.doc(path),
  collection: (path: string) => state.db.collection(path),
  getAll: (...refs: Parameters<TransferFirestoreFixture["getAll"]>) => state.db.getAll(...refs),
  runTransaction: (handler: Parameters<TransferFirestoreFixture["runTransaction"]>[0]) => state.db.runTransaction(handler),
} }));
vi.mock("../functions/src/auth/authorize.js", async importOriginal => ({
  ...await importOriginal<typeof import("../functions/src/auth/authorize")>(), requireAccess: async () => state.actor,
}));
vi.mock("../functions/src/config.js", () => ({ enforceAppCheck: false }));
import { stockTransfers } from "../functions/src/callable/stock-transfers";

const invoke = async <T = { transferId: string; repeated: boolean }>(data: object) =>
  await stockTransfers.run({ data } as Parameters<typeof stockTransfers.run>[0]) as T;
const manager = (side: "source" | "destination"): AccessProfile => ({
  userId: side, organizationId: "org", roleId: "branch_manager",
  roleIds: ["branch_manager"], directRoleIds: ["branch_manager"],
  branchIds: [side === "source" ? "source-branch" : "branch"], warehouseIds: [], authorizationVersion: 1,
});
function balance(location = "source", product = "product", lot?: string) {
  return `inventoryBalances/${balanceDocumentId("org", product, location, lot)}`;
}
const transfer = (id: string) => state.db.row(`stockTransfers/${id}`) as unknown as StockTransfer;
const key = () => crypto.randomUUID();
async function create(quantity = 5, extra: object = {}) {
  state.actor = manager("destination");
  return (await invoke({ action: "create", sourceLocationId: "source", destinationLocationId: "destination", items: [{ productId: "product", quantity }], idempotencyKey: key(), ...extra })).transferId;
}
async function approve(id: string, quantity = transfer(id).items[0]!.requested) {
  state.actor = manager("source");
  return invoke({ action: "approve", transferId: id, version: transfer(id).version, lines: [{ id: transfer(id).items[0]!.id, quantity }], idempotencyKey: key() });
}
async function receive(id: string, received: number, damaged = 0) {
  state.actor = manager("destination");
  return invoke({ action: "receive", transferId: id, version: transfer(id).version, lines: [{ id: transfer(id).items[0]!.id, received, damaged }], idempotencyKey: key() });
}
beforeEach(() => {
  state.db = new TransferFirestoreFixture();
  state.actor = manager("source");
  const active = { organizationId: "org", status: "active" };
  state.db.seed("warehouses/warehouse", { ...active, name: "Main warehouse" });
  state.db.seed("branches/branch", { ...active, name: "Receiving branch" });
  state.db.seed("branches/source-branch", { ...active, name: "Sending store",branchType:"head_office" });
  state.db.seed("organizations/org",{headOfficeBranchId:"source-branch"});
  state.db.seed("inventoryLocations/source", { ...active, name: "Sending stock", type: "branch", branchId: "source-branch" });
  state.db.seed("inventoryLocations/warehouse", { ...active, name: "Legacy warehouse", type: "warehouse", warehouseId: "warehouse" });
  state.db.seed("inventoryLocations/destination", { ...active, name: "Branch stock", type: "branch", branchId: "branch" });
  state.db.seed("products/product", { organizationId: "org", active: true, trackingType: "quantity", name: "Panel", sku: "PV" });
  state.db.seed(balance(), { organizationId: "org", productId: "product", locationId: "source", onHandQuantity: 10, reservedQuantity: 0, availableQuantity: 10, totalValueMinor: 101, version: 0 });
});


const admin:AccessProfile={userId:"admin",organizationId:"org",roleId:"system_administrator",roleIds:["system_administrator"],directRoleIds:["system_administrator"],branchIds:[],warehouseIds:[],authorizationVersion:1};
const invoice=(id:string)=>state.db.row(`internalTradeInvoices/${id}`) as unknown as InternalTradeInvoice;
async function price(id:string,value=200) {
 state.actor=admin;return invoke({action:"price",transferId:id,version:transfer(id).version,lines:transfer(id).items.map(line=>({id:line.id,unitPriceMinor:value})),idempotencyKey:key()});
}
async function ready(qty=5) { const id=await create(qty);await price(id);await approve(id);return id; }
const payment=(invoiceId:string,amountMinor:number)=>({action:"record_payment",invoiceId,amountMinor,sourceMethod:"cash",destinationMethod:"cash",paymentDate:new Date().toISOString(),confirmedCompleted:true,reference:"Cash delivered to HQ",idempotencyKey:key()});
const returnInput=(id:string,quantity:number)=>({action:"return_goods",confirmedReceived:true,confirmedResellable:true,invoiceId:id,lines:[{id:invoice(id).lines[0]!.id,quantity}],note:"Goods physically received at HQ",idempotencyKey:key()});
describe("internal trade actual callable with atomic transaction fixture",()=>{
 it("applies to future HQ supplies, not existing unreceived transfers or peer-store transfers",async()=>{
  state.db.seed("organizations/org",{});const legacy=await create(2);state.db.seed("organizations/org",{headOfficeBranchId:"source-branch"});await approve(legacy);await receive(legacy,2);
  expect(invoice(legacy)).toBeUndefined();const fresh=await create(2);expect(transfer(fresh).tradeAgreement?.pricingStatus).toBe("required");
  state.db.seed("organizations/org",{headOfficeBranchId:"different-hq"});const peer=await create(2);expect(transfer(peer).tradeAgreement).toBeUndefined();
 });
 it("rejects unpriced approval, unauthorized pricing, injected prices, and post-approval repricing",async()=>{
  const id=await create();await expect(approve(id)).rejects.toThrow(/price/);
  await expect(invoke({action:"price",transferId:id,version:0,lines:[{id:transfer(id).items[0]!.id,unitPriceMinor:200}],idempotencyKey:key()})).rejects.toMatchObject({code:"permission-denied"});
  await price(id);await approve(id);await expect(price(id,1)).rejects.toThrow();expect(invoice(id)).toBeUndefined();
  await receive(id,1);expect(invoice(id).totalMinor).toBe(200);
 });
 it("posts partial invoices, exact source-cost evidence and one stock movement under retries",async()=>{
  const id=await ready(10);state.db.retryNext=true;await receive(id,3);expect(invoice(id)).toMatchObject({totalMinor:600,balanceMinor:600});
  expect(state.db.all("internalTradeEntries")).toHaveLength(1);
  const event=state.db.all("internalTradeEntries")[0]!;expect(event.receiptLines).toEqual([expect.objectContaining({quantity:3,unitPriceMinor:200,companyReceivedValueMinor:30})]);expect(event.inventoryTransactionIds).toHaveLength(1);
  await receive(id,7);expect(invoice(id).totalMinor).toBe(2000);expect(state.db.row(balance("destination")).totalValueMinor).toBe(101);expect(state.db.row(balance()).totalValueMinor).toBe(0);
  expect(state.db.all("journalEntries")).toHaveLength(0);expect(state.db.all("supplierInvoices")).toHaveLength(0);
 });
 it("rolls back stock and invoice on invoice commit failure and period locks",async()=>{
  const id=await ready();state.db.failNextCommitFor="internalTradeInvoices/";await expect(receive(id,2)).rejects.toThrow(/Injected/);expect(invoice(id)).toBeUndefined();expect(state.db.row(balance()).onHandQuantity).toBe(10);
  state.db.seed(`accountingPeriods/${uniquenessDocumentId("org",new Date().toISOString().slice(0,7))}`,{status:"closed"});await expect(receive(id,2)).rejects.toThrow(/period/);expect(invoice(id)).toBeUndefined();
 });
 it("preserves snapshotted HQ and permits new HQ balances without rewriting old debt",async()=>{
  const old=await ready(2);state.db.seed("organizations/org",{headOfficeBranchId:"new-hq"});await receive(old,2);expect(invoice(old).headOfficeBranchId).toBe("source-branch");
  state.db.seed("branches/new-hq",{organizationId:"org",name:"New HQ",status:"active",branchType:"head_office"});state.db.seed("inventoryLocations/new-source",{organizationId:"org",name:"New HQ stock",status:"active",type:"branch",branchId:"new-hq"});state.db.seed(balance("new-source"),{...state.db.row(balance()),locationId:"new-source",onHandQuantity:5,reservedQuantity:0,totalValueMinor:50});
  const fresh=await create(1,{sourceLocationId:"new-source"});await price(fresh);state.actor=admin;await invoke({action:"approve",transferId:fresh,version:transfer(fresh).version,lines:[{id:transfer(fresh).items[0]!.id,quantity:1}],idempotencyKey:key()});await receive(fresh,1);
  expect(state.db.row(`internalTradeBalances/${internalTradeBalanceId("org","source-branch","branch")}`).balanceMinor).toBe(400);expect(state.db.row(`internalTradeBalances/${internalTradeBalanceId("org","new-hq","branch")}`).balanceMinor).toBe(200);
 });
 it("records completed cash once through paired clearing journals and prevents reallocation",async()=>{
  const id=await ready();await receive(id,5);state.actor=admin;const input=payment(id,300), result=await invoke<Record<string,unknown>>(input);await invoke(input);
  expect(invoice(id)).toMatchObject({paidMinor:300,balanceMinor:700});expect(state.db.all("journalEntries")).toHaveLength(2);expect(state.db.all("journalLines").filter(line=>line.accountCode==="1380")).toHaveLength(2);
  await expect(invoke({...input,amountMinor:301})).rejects.toThrow();await expect(invoke({...payment(id,50),existingFundsTransferId:result.journalEntryId,paymentDate:input.paymentDate})).rejects.toThrow(/allocated/);
  await expect(invoke(payment(id,701))).rejects.toThrow(/exceeds/);
 });
 it("rejects branch payment and supports returns after settlement then later receipt",async()=>{
  const id=await ready();await receive(id,3);await expect(invoke(payment(id,600))).rejects.toMatchObject({code:"permission-denied"});state.actor=admin;await invoke(payment(id,600));await invoke(returnInput(id,1));expect(invoice(id).balanceMinor).toBe(-200);
  await receive(id,2);expect(invoice(id)).toMatchObject({totalMinor:1000,paidMinor:600,returnedMinor:200,balanceMinor:200});expect(state.db.row(`internalTradeBalances/${internalTradeBalanceId("org","source-branch","branch")}`).balanceMinor).toBe(200);
 });
 it("returns goods and invoice credit atomically, retains original price and blocks excessive returns",async()=>{
  const id=await ready();await receive(id,5);state.actor=admin;const input={...returnInput(id,2),operatingContext:{type:"branch",id:"branch"}};await invoke(input);await invoke(input);expect(invoice(id)).toMatchObject({returnedMinor:400,balanceMinor:600});expect(state.db.row(balance("destination")).onHandQuantity).toBe(3);await expect(invoke(returnInput(id,4))).rejects.toThrow();
 });
 it("redacts financial details from transfer-only custom readers without disabling stock workflow",async()=>{
  const id=await ready();await receive(id,1);
  state.db.seed("roles/custom",{organizationId:"org",baseRoleId:"branch_manager",permissionIds:["transfers.read.own_branch"],status:"active"});
  state.actor={...manager("destination"),directRoleIds:[],customRoleIds:["custom"],effectivePermissions:["transfers.read.own_branch"]};
  const detail=await invoke<{transfer:StockTransfer;invoice:unknown;canReadTrading:boolean}>({action:"get",transferId:id});expect(detail.invoice).toBeNull();expect(detail.canReadTrading).toBe(false);expect(detail.transfer.tradeAgreement?.pricesByLineId).toEqual({});expect(JSON.stringify(detail)).not.toContain("unitPriceMinor");
  const workspace=await invoke<InternalTradeWorkspace>({action:"trading_workspace"});expect(workspace.canReadTrading).toBe(false);expect(workspace.balances).toEqual([]);
 });
 it("returns scoped invoices, complete balances, and redacted immutable statement entries",async()=>{
  const id=await ready();await receive(id,2);state.actor=admin;await invoke(payment(id,100));state.actor=manager("destination");
  const workspace=await invoke<InternalTradeWorkspace>({action:"trading_workspace",invoiceId:id});expect(workspace.invoices).toHaveLength(1);expect(workspace.entries.map(entry=>entry.kind)).toEqual(["invoice","payment"]);expect(workspace.balances[0]!.balanceMinor).toBe(300);expect(workspace.accounts).toEqual([]);expect(JSON.stringify(workspace)).not.toContain("companyReceivedValueMinor");
 });
 it("physically receives damage into quarantine with charge held until explicit review",async()=>{
  const id=await ready(5);await receive(id,2,3);expect(invoice(id)).toMatchObject({totalMinor:400,balanceMinor:400});expect(invoice(id).lines[0]).toMatchObject({receivedQuantity:2,damagedQuantity:3,pendingDamagedQuantity:3,chargedDamagedQuantity:0});
  const quarantine=balance("simple_damaged_branch");expect(state.db.row(quarantine).onHandQuantity).toBe(3);const stockBefore=state.db.all("inventoryEntries");
  const review={operatingContext:{type:"branch",id:"branch"},action:"review_damage",invoiceId:id,version:invoice(id).version,decision:"charge",lines:[{id:invoice(id).lines[0]!.id,quantity:1}],note:"Damage reviewed and charge accepted",idempotencyKey:key()};
  await expect(invoke(review)).rejects.toMatchObject({code:"permission-denied"});state.actor=admin;await invoke(review);await invoke(review);expect(invoice(id)).toMatchObject({totalMinor:600,balanceMinor:600});expect(invoice(id).lines[0]).toMatchObject({pendingDamagedQuantity:2,chargedDamagedQuantity:1});
  await invoke({...review,version:invoice(id).version,decision:"no_charge",lines:[{id:invoice(id).lines[0]!.id,quantity:2}],note:"HQ accepts the remaining damage cost",idempotencyKey:key()});
  expect(invoice(id).lines[0]).toMatchObject({pendingDamagedQuantity:0,waivedDamagedQuantity:2});expect(state.db.all("inventoryEntries")).toEqual(stockBefore);expect(state.db.row(quarantine).onHandQuantity).toBe(3);await expect(invoke(returnInput(id,3))).rejects.toThrow();
 });
 it("creates a zero-value held invoice for an all-damaged receipt without making stock saleable",async()=>{
  const id=await ready(2);state.db.seed(`accountingPeriods/${uniquenessDocumentId("org",new Date().toISOString().slice(0,7))}`,{status:"closed"});await receive(id,0,2);expect(invoice(id)).toMatchObject({totalMinor:0,balanceMinor:0});expect(invoice(id).lines[0]).toMatchObject({receivedQuantity:0,pendingDamagedQuantity:2});expect(state.db.row(balance("destination"))).toBeUndefined();expect(state.db.all("internalTradeEntries")[0]!.kind).toBe("damage_hold");
 });

 it("fails closed without writes when existing invoice identity or composite balance is corrupt",async()=>{
  const id=await ready(5);await receive(id,1);
  const invoicePath=`internalTradeInvoices/${id}`,balancePath=`internalTradeBalances/${internalTradeBalanceId("org","source-branch","branch")}`;
  const originalInvoice=state.db.row(invoicePath),originalBalance=state.db.row(balancePath);
  for (const field of ["id","transferId","organizationId","branchId","headOfficeBranchId","sourceLocationId","destinationLocationId","sourceBranchId","sourceWarehouseId","currency"]) {
   state.db.seed(invoicePath,{...originalInvoice,[field]:"corrupt"});const before=new Map(state.db.rows);await expect(receive(id,1)).rejects.toMatchObject({code:"failed-precondition"});expect(state.db.rows).toEqual(before);
  }
  state.db.rows.delete(invoicePath);let missingBefore=new Map(state.db.rows);await expect(receive(id,1)).rejects.toThrow(/invoice is missing/);expect(state.db.rows).toEqual(missingBefore);
  state.db.seed(invoicePath,{...originalInvoice,lines:[{...((originalInvoice.lines as object[])[0]),receivedQuantity:0}]});missingBefore=new Map(state.db.rows);await expect(receive(id,1)).rejects.toThrow(/line evidence/);expect(state.db.rows).toEqual(missingBefore);
  state.db.seed(invoicePath,originalInvoice);state.db.rows.delete(balancePath);let before=new Map(state.db.rows);await expect(receive(id,1)).rejects.toThrow(/missing HQ balance/);expect(state.db.rows).toEqual(before);
  for (const field of ["organizationId","branchId","headOfficeBranchId"]) {
   state.db.seed(balancePath,{...originalBalance,[field]:"corrupt"});before=new Map(state.db.rows);await expect(receive(id,1)).rejects.toThrow(/identity/);expect(state.db.rows).toEqual(before);
  }
 });
 it("rejects unsafe requested invoice totals before prices can be saved",async()=>{
  const items=Array.from({length:20},(_,index)=>({productId:`priced-${index}`,quantity:1_000_000}));
  for (const item of items) state.db.seed(`products/${item.productId}`,{organizationId:"org",active:true,trackingType:"quantity",name:item.productId,sku:item.productId});
  const id=await create(1,{items});const before=new Map(state.db.rows);await expect(price(id,1_000_000_000)).rejects.toThrow(/out of range/);expect(state.db.rows).toEqual(before);expect(transfer(id).tradeAgreement?.pricingStatus).toBe("required");
 });
 it("rejects unsafe held damage amounts even when the immediate invoice charge is zero",async()=>{
  const id=await ready(2),original=transfer(id);state.db.seed(`stockTransfers/${id}`,{...original,tradeAgreement:{...original.tradeAgreement,pricesByLineId:{[original.items[0]!.id]:Number.MAX_SAFE_INTEGER}}});
  const before=new Map(state.db.rows);await expect(receive(id,0,2)).rejects.toThrow(/out of range/);expect(state.db.rows).toEqual(before);expect(invoice(id)).toBeUndefined();
 });

 it("marks only proven absent stale version-bound instructions safe to replace, preserving committed retries",async()=>{
  const id=await ready(5);state.actor=manager("destination");
  const input={action:"receive",transferId:id,version:transfer(id).version,lines:[{id:transfer(id).items[0]!.id,received:1,damaged:1}],idempotencyKey:key()};
  await invoke(input);await receive(id,1);expect(await invoke(input)).toMatchObject({repeated:true});
  await expect(invoke({...input,idempotencyKey:key()})).rejects.toMatchObject({details:{code:"SAVED_ACTION_NOT_COMMITTED"}});
  await expect(invoke({...input,version:transfer(id).version+1,idempotencyKey:key()})).rejects.toMatchObject({details:{code:"STOCK_TRANSFER_ACTION_REQUIRED"}});
  state.actor=admin;const review={action:"review_damage",invoiceId:id,version:invoice(id).version,decision:"no_charge",lines:[{id:invoice(id).lines[0]!.id,quantity:1}],note:"HQ accepts damage",idempotencyKey:key()};
  await invoke(review);expect(await invoke(review)).toMatchObject({repeated:true});
  await expect(invoke({...review,idempotencyKey:key()})).rejects.toMatchObject({details:{code:"SAVED_ACTION_NOT_COMMITTED"}});
 });

 it("rejects corrupt or exhausted invoice and aggregate versions without writes",async()=>{
  const id=await ready(5);await receive(id,1);
  for (const path of [`internalTradeInvoices/${id}`,`internalTradeBalances/${internalTradeBalanceId("org","source-branch","branch")}`]) {
   const original=state.db.row(path);
   for (const version of [undefined,null,"1",-1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER+1]) {
    state.db.seed(path,{...original,version});const before=new Map(state.db.rows);
    await expect(receive(id,1)).rejects.toMatchObject({code:"failed-precondition"});expect(state.db.rows).toEqual(before);
   }
   state.db.seed(path,original);
  }
  for (const path of [`internalTradeInvoices/${id}`,`internalTradeBalances/${internalTradeBalanceId("org","source-branch","branch")}`]) {
   const original=state.db.row(path);state.db.seed(path,{...original,balanceMinor:-Number.MAX_SAFE_INTEGER-1});const before=new Map(state.db.rows);
   await expect(receive(id,1)).rejects.toMatchObject({code:"failed-precondition"});expect(state.db.rows).toEqual(before);state.db.seed(path,original);
  }
 });

});

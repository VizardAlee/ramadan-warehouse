import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessProfile } from "../functions/src/auth/authorize";
import { balanceDocumentId, uniquenessDocumentId, normalizeInventoryIdentifier } from "../functions/src/inventory/calculations";
import type { StockTransfer } from "../functions/src/transfers/simple-model";
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
const purchaser: AccessProfile = { userId: "purchaser", organizationId: "org", roleId: "purchasing_manager", roleIds: ["purchasing_manager"], directRoleIds: ["purchasing_manager"], branchIds: [], warehouseIds: [], authorizationVersion: 1 };
function balance(location = "source", product = "product", lot?: string) {
  return `inventoryBalances/${balanceDocumentId("org", product, location, lot)}`;
}
const transfer = (id: string) => state.db.row(`stockTransfers/${id}`) as unknown as StockTransfer;
const key = () => crypto.randomUUID();
async function create(quantity = 5, extra: object = {}) {
  state.actor = purchaser;
  const id = (await invoke({ action: "create", sourceLocationId: "source", destinationLocationId: "destination", items: [{ productId: "product", quantity }], idempotencyKey: key(), ...extra })).transferId;
  // New branch supplies require administrator pricing before stock confirmation.
  state.actor = {userId:"admin",organizationId:"org",roleId:"system_administrator",roleIds:["system_administrator"],directRoleIds:["system_administrator"],branchIds:[],warehouseIds:[],authorizationVersion:1};
  await invoke({action:"price",transferId:id,version:transfer(id).version,lines:transfer(id).items.map(line=>({id:line.id,unitPriceMinor:200})),idempotencyKey:key()});
  state.actor = manager("destination");
  return id;
}
async function approve(id: string, quantity = transfer(id).items[0]!.requested) {
  state.actor = purchaser;
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
  state.db.seed("branches/source-branch", { ...active, name: "Sending store" });
  state.db.seed("inventoryLocations/source", { ...active, name: "Sending stock", type: "branch", branchId: "source-branch" });
  state.db.seed("inventoryLocations/warehouse", { ...active, name: "Legacy warehouse", type: "warehouse", warehouseId: "warehouse" });
  state.db.seed("inventoryLocations/destination", { ...active, name: "Branch stock", type: "branch", branchId: "branch" });
  state.db.seed("products/product", { organizationId: "org", active: true, trackingType: "quantity", name: "Panel", sku: "PV" });
  state.db.seed(balance(), { organizationId: "org", productId: "product", locationId: "source", onHandQuantity: 10, reservedQuantity: 0, availableQuantity: 10, totalValueMinor: 101, version: 0 });
});

describe("landed-cost internal returns",()=>{
  const admin = () => {state.actor={userId:"admin",organizationId:"org",roleId:"system_administrator",roleIds:["system_administrator"],directRoleIds:["system_administrator"],branchIds:[],warehouseIds:[],authorizationVersion:1};};
  async function returned(id:string,quantity:number,idempotencyKey=key()){
    admin();return invoke({action:"return_goods",invoiceId:id,confirmedReceived:true,confirmedResellable:true,lines:[{id:transfer(id).items[0]!.id,quantity,serialItemIds:[]}],note:"Goods physically returned",idempotencyKey});
  }
  it("returns original managerial basis rather than internal markup and is retry-safe",async()=>{
    const id=await create(10);await approve(id);await receive(id,10);
    const retry=key();await returned(id,2,retry);await returned(id,2,retry);
    expect(state.db.row(balance())).toMatchObject({onHandQuantity:2,totalValueMinor:20,managementTotalValueMinor:20});
    expect(state.db.row(balance("destination"))).toMatchObject({onHandQuantity:8,totalValueMinor:81,managementTotalValueMinor:1600});
    await returned(id,8);
    expect(state.db.row(balance())).toMatchObject({onHandQuantity:10,totalValueMinor:101,managementTotalValueMinor:101});
    expect(state.db.row(balance("destination"))).toMatchObject({onHandQuantity:0,totalValueMinor:0,managementTotalValueMinor:0});
    expect(state.db.row(`internalTradeInvoices/${id}`)).toMatchObject({returnedMinor:2000,balanceMinor:0});
    expect(state.db.all("internalTradeReturns")).toHaveLength(2);
  });
  it("keeps capitalized freight with returned stock and does not refund it",async()=>{
    const id=await create(10);
    state.db.seed("expenses/freight",{organizationId:"org",status:"approved",branchId:"source-branch",expenseNumber:"FRT",payeeName:"Carrier",supplierDocumentNumber:"REF",netAmountMinor:7});
    admin();await invoke({action:"price",transferId:id,version:transfer(id).version,lines:transfer(id).items.map(line=>({id:line.id,unitPriceMinor:200})),transport:{totalMinor:7,payer:"source",payee:"Carrier",reference:"REF",expenseNumber:"FRT"},idempotencyKey:key()});
    await approve(id);await receive(id,10);await returned(id,10);
    expect(state.db.row(balance())).toMatchObject({onHandQuantity:10,totalValueMinor:108,managementTotalValueMinor:108});
    expect(state.db.row(`internalTradeInvoices/${id}`)).toMatchObject({totalMinor:2007,returnedMinor:2000,balanceMinor:7});
    expect(state.db.row("expenses/freight").transportCapitalizedMinor).toBe(7);
    expect(state.db.all("internalTradeReturns")[0]).toMatchObject({freightRefundMinor:0,managementCostVersion:1});
  });
  it("restores exact serial managerial cost and balances its valuation entries",async()=>{
    const serialId=uniquenessDocumentId("org",normalizeInventoryIdentifier("SERIAL-1"));
    state.db.seed("products/serial",{organizationId:"org",active:true,trackingType:"serial",name:"Inverter",sku:"INV"});
    state.db.seed(balance("source","serial"),{organizationId:"org",productId:"serial",locationId:"source",onHandQuantity:1,reservedQuantity:0,availableQuantity:1,totalValueMinor:100,managementTotalValueMinor:125,version:0});
    state.db.seed(`serializedItems/${serialId}`,{organizationId:"org",productId:"serial",serialNumber:"SERIAL-1",currentLocationId:"source",branchId:"source-branch",status:"at_branch",active:true,currentUnitCostMinor:100,managementUnitCostMinor:125});
    const id=await create(1,{items:[{productId:"serial",quantity:1}]});
    state.actor=purchaser;await invoke({action:"approve",transferId:id,version:transfer(id).version,lines:[{id:transfer(id).items[0]!.id,quantity:1,serialItemIds:[serialId]}],idempotencyKey:key()});
    state.actor=manager("destination");await invoke({action:"receive",transferId:id,version:transfer(id).version,lines:[{id:transfer(id).items[0]!.id,received:1,damaged:0,serialItemIds:[serialId]}],idempotencyKey:key()});
    admin();await invoke({action:"return_goods",invoiceId:id,confirmedReceived:true,confirmedResellable:true,lines:[{id:transfer(id).items[0]!.id,quantity:1,serialItemIds:[serialId]}],note:"Serial physically returned",idempotencyKey:key()});
    expect(state.db.row(`serializedItems/${serialId}`)).toMatchObject({currentLocationId:"source",currentUnitCostMinor:100,managementUnitCostMinor:125});
    expect(state.db.row(balance("source","serial"))).toMatchObject({onHandQuantity:1,totalValueMinor:100,managementTotalValueMinor:125});
    const result=state.db.all("internalTradeReturns")[0]!;
    const transactions=result.inventoryTransactionIds as string[];
    const entries=state.db.all("inventoryEntries").filter(e=>transactions.includes(String(e.transactionId)));
    expect(entries.reduce((sum,e)=>sum+Number(e.managementValueDeltaMinor),0)).toBe(0);
    const journals=state.db.all("journalLines");
    expect(journals.some(row=>String(row.accountCode).startsWith("5"))).toBe(false);
    expect(journals).toEqual(expect.arrayContaining([expect.objectContaining({accountCode:"1200",branchId:"branch",managementCreditMinor:200}),expect.objectContaining({accountCode:"1200",branchId:"source-branch",managementDebitMinor:125}),expect.objectContaining({accountCode:"3990",managementDebitMinor:75})]));
  });
  it("fails atomically when original receipt cost evidence is missing",async()=>{
    const id=await create(10);await approve(id);await receive(id,10);
    for(const [path,row] of state.db.rows)if(path.startsWith("inventoryEntries/")&&row.locationId==="source")state.db.rows.delete(path);
    await expect(returned(id,1)).rejects.toThrow();
    expect(state.db.row(balance("destination")).onHandQuantity).toBe(10);
    expect(state.db.all("internalTradeReturns")).toHaveLength(0);
  });
});

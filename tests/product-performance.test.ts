import { describe, expect, it } from "vitest";
import { addMovementEntry, emptyMovementRow, type MovementEvidence } from "../functions/src/reports/product-movement";
import { calendarDays, productPerformanceInput } from "../functions/src/validation/product-performance";
import { marginPercent, rankMovement, rankProfit, type ProfitRow } from "../src/features/reports/product-performance-presentation";
const parent: MovementEvidence = { id: "tx", status: "posted", transactionType: "branch_sale", referenceType: "sale", referenceId: "sale", sourceBranchId: "a" };
const entry: MovementEvidence = { id: "leg", branchId: "a", locationId: "stock", productId: "p", quantityDelta: -3, transactionType: "branch_sale" };
const row = () => emptyMovementRow("p", "Part", "P");
describe("physical movement basis", () => {
 it("counts local legs once and excludes balancing legs, transfers and reservations", () => {
  const r=row(); addMovementEntry(r,entry,parent);
  for(const e of [{...entry,id:"external",externalAccount:"customer_sales",quantityDelta:3},{...entry,id:"transfer",transactionType:"branch_transfer"},{...entry,id:"reservation",transactionType:"sale_reservation",quantityDelta:0}]) addMovementEntry(r,e,parent);
  expect(r).toMatchObject({handedOverQuantity:3,netCustomerQuantity:3,entryCount:1});
 });
 it("keeps service parts outside customer handovers and counts actual held restock", () => {
  const r=row();addMovementEntry(r,{...entry,partsMode:"included",serviceSaleItemId:"service"},parent);
  addMovementEntry(r,{...entry,id:"restore",transactionType:"held_return_restock",quantityDelta:2},{id:"held",status:"posted",transactionType:"held_return_restock",referenceType:"aftersalesCase",referenceId:"case",branchId:"a"});
  expect(r).toMatchObject({handedOverQuantity:0,includedPartsQuantity:3,restockedQuantity:2,netCustomerQuantity:-2});
 });
 it("counts later collection independently from invoice and supports serial/lot local rows", () => {
  const r=row();for(let i=0;i<3;i++)addMovementEntry(r,{...entry,id:`serial${i}`,transactionType:"customer_collection",quantityDelta:-1,serializedItemId:`s${i}`},{...parent,transactionType:"customer_collection",referenceType:"saleCollection"});
  expect(r.handedOverQuantity).toBe(3);
 });
 it("reverses only independently proven original local quantity", () => {
  const r=row(); const reversal={...parent,id:"rev",transactionType:"reversal",reversalOfTransactionId:"tx"};
  addMovementEntry(r,{...entry,id:"revleg",transactionType:"reversal",quantityDelta:3},reversal,parent,-3);
  expect(r).toMatchObject({handedOverQuantity:-3,netCustomerQuantity:-3,unknownEntryCount:0});
  addMovementEntry(r,{...entry,transactionType:"reversal",quantityDelta:3},reversal,parent,undefined);
  expect(r.unknownEntryCount).toBe(1);
 });
 it("quarantines missing, wrong-scope, malformed direction and unsafe evidence", () => {
  const r=row();for(const [e,p] of [[entry,undefined],[entry,{...parent,sourceBranchId:"b"}],[{...entry,quantityDelta:3},parent],[{...entry,quantityDelta:Number.MAX_SAFE_INTEGER+1},parent]] as const) addMovementEntry(r,e,p);
  expect(r).toMatchObject({handedOverQuantity:0,unknownEntryCount:4});
 });
 it("separates positive, zero, negative and incomplete rankings deterministically", () => {
  const rows=[{...row(),productId:"fast",netCustomerQuantity:8,handedOverQuantity:8},{...row(),productId:"slow",netCustomerQuantity:1,handedOverQuantity:1},{...row(),productId:"zero",activeLocalGoods:true},{...row(),productId:"returns",netCustomerQuantity:-2,restockedQuantity:2},{...row(),productId:"unknown",netCustomerQuantity:99,unknownEntryCount:1}];
  expect(rankMovement(rows,"fast").map(r=>r.productId)).toEqual(["fast","slow"]);expect(rankMovement(rows,"slow")[0]?.productId).toBe("slow");expect(rankMovement(rows,"zero")[0]?.productId).toBe("zero");expect(rankMovement(rows,"returns")[0]?.productId).toBe("returns");expect(rankMovement(rows,"unknown")[0]?.productId).toBe("unknown");
 });
});
const profit=(id:string,profit:number|null,revenue=100):ProfitRow=>({productId:id,productName:id,sku:id,invoicedQuantity:1,reversedQuantity:0,invoicedNetMinor:revenue,reversedNetMinor:0,netSalesMinor:revenue,recordedCostMinor:0,restockCreditMinor:0,netRecordedCostMinor:0,unknownCostLines:profit===null?1:0,grossMarginMinor:profit});
describe("gross contribution ranking",()=>{
 it("preserves losses, excludes unknown numeric values and never creates zero-revenue percentages",()=>{
  const rows=[profit("loss",-20),profit("gain",50),profit("unknown",null),profit("zero",0,0)];expect(rankProfit(rows,"lowest")[0]?.productId).toBe("loss");expect(rankProfit(rows,"highest").map(r=>r.productId)).toEqual(["gain","zero","loss"]);expect(rankProfit(rows,"unknown")[0]?.productId).toBe("unknown");expect(marginPercent(rows[3]!)).toBeNull();expect(marginPercent(rows[0]!)).toBe("-20.00%");
 });
 it("compares large rational margins exactly with stable ties and rounds signed percentages",()=>{
  const n=Number.MAX_SAFE_INTEGER;const rows=[profit("a",n-2,n-1),profit("z",n-1,n)];expect(rankProfit(rows,"margin-high")[0]?.productId).toBe("z");expect(rankProfit(rows,"margin-low")[0]?.productId).toBe("a");expect(rankProfit([profit("z",1,2),profit("a",2,4)],"margin-high").map(row=>row.productId)).toEqual(["a","z"]);expect(marginPercent(profit("tiny",-1,3))).toBe("-33.33%");expect(marginPercent(profit("round",2,3))).toBe("66.67%");
 });
 it("validates real dates, safe IDs and inclusive calendar-day bounds",()=>{
  expect(calendarDays("2026-10-01","2026-10-01")).toBe(1);expect(calendarDays("2024-02-28","2024-03-01")).toBe(3);
  for(const patch of [{toDate:"2026-09-30"},{toDate:"2028-10-01"},{fromDate:"2026-02-30"},{productId:"../other"}])expect(productPerformanceInput.safeParse({fromDate:"2026-10-01",toDate:"2026-10-31",...patch}).success).toBe(false);
 });
});

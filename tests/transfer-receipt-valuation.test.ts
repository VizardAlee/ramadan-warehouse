import {describe,it,expect} from "vitest";
import {planReceiptValuation} from "../functions/src/branch-trading/receipt-valuation";

describe("atomic receipt valuation plan (integration not yet released)",()=>{
 const base={sourceQuantity:10,sourceCompanyMinor:1000,sourceManagementMinor:1400,received:2,damaged:1,agreedUnitPriceMinor:200,transport:{allocatedMinor:101,approvedQuantity:10,previouslyReceivedOrDamaged:0}};
 it("separates agreed branch cost from company carrying value and freight",()=>{
  const p=planReceiptValuation(base);
  expect(p.outgoingCompanyMinor).toBe(300);expect(p.outgoingManagementMinor).toBe(420);
  expect(p.remainingCompanyMinor).toBe(700);expect(p.remainingManagementMinor).toBe(980);
  expect(p.companyReceivedMinor+p.companyDamagedMinor).toBe(330);
  expect(p.managementReceivedMinor+p.managementDamagedMinor).toBe(630);
  expect(p.transportMinor).toBe(30);
 });
 it("preserves managerial values on legacy transfers, not resetting to company costs",()=>{
  const p=planReceiptValuation({...base,agreedUnitPriceMinor:undefined,transport:undefined});
  expect(p.companyReceivedMinor+p.companyDamagedMinor).toBe(300);
  expect(p.managementReceivedMinor+p.managementDamagedMinor).toBe(420);
 });
 it("conserves partial/final receipts including damaged freight",()=>{
  let company=1000,management=1400,remaining=10,freight=0,companyReceived=0,branchReceived=0;
  for(let i=0;i<10;i++){
   const p=planReceiptValuation({...base,sourceQuantity:remaining,sourceCompanyMinor:company,sourceManagementMinor:management,received:i%2,damaged:1-i%2,transport:{...base.transport,previouslyReceivedOrDamaged:i}});
   freight+=p.transportMinor;companyReceived+=p.companyReceivedMinor+p.companyDamagedMinor;branchReceived+=p.managementReceivedMinor+p.managementDamagedMinor;
   company=p.remainingCompanyMinor;management=p.remainingManagementMinor;remaining--;
  }
  expect({company,management,freight,companyReceived,branchReceived}).toEqual({company:0,management:0,freight:101,companyReceived:1101,branchReceived:2101});
 });
 it("retains per-serial company costs and deterministic freight rounding",()=>{
  const serials=[{id:"b",companyMinor:400,managementMinor:500,damaged:true},{id:"a",companyMinor:600,managementMinor:900,damaged:false}];
  const input={...base,sourceQuantity:2,received:1,damaged:1,transport:{allocatedMinor:5,approvedQuantity:2,previouslyReceivedOrDamaged:0},serials};
  const p=planReceiptValuation(input),reverse=planReceiptValuation({...input,serials:[...serials].reverse()});
  expect(p.companyReceivedMinor).toBe(603);expect(p.companyDamagedMinor).toBe(402);
  expect(p.managementReceivedMinor).toBe(203);expect(p.managementDamagedMinor).toBe(202);
  expect(reverse.companyReceivedMinor).toBe(p.companyReceivedMinor);expect(p.remainingManagementMinor).toBe(0);
 });
 it("rejects impossible source/serial evidence and unapproved freight basis",()=>{
  expect(()=>planReceiptValuation({...base,sourceQuantity:2})).toThrow();
  expect(()=>planReceiptValuation({...base,agreedUnitPriceMinor:undefined})).toThrow();
  expect(()=>planReceiptValuation({...base,serials:[]})).toThrow();
  expect(()=>planReceiptValuation({...base,received:0,damaged:0})).toThrow();
  expect(()=>planReceiptValuation({...base,sourceManagementMinor:-1})).toThrow();
  expect(()=>planReceiptValuation({...base,agreedUnitPriceMinor:Number.MAX_SAFE_INTEGER})).toThrow();
 });
});

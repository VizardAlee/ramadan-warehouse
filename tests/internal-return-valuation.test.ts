import { describe,it,expect } from "vitest";
import { originalReturnManagementCost } from "../functions/src/branch-trading/return-valuation";
describe("original internal-return management costs",()=>{
 const receipt={received:3,damaged:1,unitPriceMinor:200,source:[{quantity:4,companyMinor:40,managementMinor:80}],destination:[{quantity:3,companyMinor:37,managementMinor:607}]};
 it("removes markup, retains freight, and conserves repeated partial rounding",()=>{
  let prior=0; const amounts=[0,1,2].map(returned=>{const value=originalReturnManagementCost([receipt],3,returned,1,undefined,prior).valueMinor;prior+=value;return value;});
  expect(amounts.reduce((a,b)=>a+b,0)).toBe(67);
 });
 it("preserves actual prior returns when later receipt changes original average cost",()=>{
   const first={received:2,damaged:0,unitPriceMinor:200,source:[{quantity:2,companyMinor:20,managementMinor:20}],destination:[{quantity:2,companyMinor:20,managementMinor:400}]};
   const later={received:2,damaged:0,unitPriceMinor:200,source:[{quantity:2,companyMinor:80,managementMinor:80}],destination:[{quantity:2,companyMinor:80,managementMinor:400}]};
   const previous=originalReturnManagementCost([first],2,0,1).valueMinor;
   expect(previous).toBe(10);
   expect(originalReturnManagementCost([first,later],4,1,3,undefined,previous).valueMinor).toBe(90);
   expect(()=>originalReturnManagementCost([first,later],4,1,1)).toThrow();
 });
 it("uses exact original serial managerial costs plus each serial freight",()=>{
  const r={received:2,damaged:0,unitPriceMinor:200,source:[{quantity:1,companyMinor:10,managementMinor:15,serialId:"a"},{quantity:1,companyMinor:12,managementMinor:17,serialId:"b"}],destination:[{quantity:1,companyMinor:13,managementMinor:203,serialId:"a"},{quantity:1,companyMinor:14,managementMinor:202,serialId:"b"}]};
  expect(originalReturnManagementCost([r],2,0,1,["b"])).toEqual({valueMinor:19,serialValues:{b:19}});
 });
 it("rejects incomplete, duplicated serial, negative freight and over-return evidence",()=>{
  expect(()=>originalReturnManagementCost([receipt],4,0,1)).toThrow();
  expect(()=>originalReturnManagementCost([receipt],3,3,1)).toThrow();
  expect(()=>originalReturnManagementCost([{...receipt,destination:[{quantity:3,companyMinor:37,managementMinor:599}]}],3,0,1)).toThrow();
 });
});

import {expect,it} from "vitest";
import {issueManagementCost} from "../functions/src/inventory/management-cost";
it("falls back to original company values for legacy balances",()=>{expect(issueManagementCost({quantity:3,totalValueMinor:10},1)).toEqual({movementValueMinor:3,remainingValueMinor:7});});
it("issues branch value independently",()=>{expect(issueManagementCost({quantity:3,totalValueMinor:10,managementTotalValueMinor:15},1)).toEqual({movementValueMinor:5,remainingValueMinor:10});});
it("consumes final remainder exactly",()=>{expect(issueManagementCost({quantity:1,totalValueMinor:3,managementTotalValueMinor:4},1).remainingValueMinor).toBe(0);});
it("rejects inconsistent serial and negative costs",()=>{expect(()=>issueManagementCost({quantity:1,totalValueMinor:3,managementTotalValueMinor:4},1,3)).toThrow();expect(()=>issueManagementCost({quantity:2,totalValueMinor:3},1,-1)).toThrow();});

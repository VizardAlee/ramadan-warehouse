import {expect,it} from 'vitest';
import {issueManagementCost} from '../functions/src/sales/management-issue';
it('conserves proportional managerial cost and final remainder',()=>{const first=issueManagementCost(3,10,1); expect(first.movementValueMinor).toBe(3); expect(issueManagementCost(2,first.balance.totalValueMinor,2).movementValueMinor).toBe(7);});
it('uses selected original serial managerial costs',()=>{expect(issueManagementCost(3,100,2,[20,30]).balance.totalValueMinor).toBe(50); expect(()=>issueManagementCost(2,100,2,[20,30])).toThrow();});
it('rejects malformed or excessive values',()=>{expect(()=>issueManagementCost(2,100,3)).toThrow(); expect(()=>issueManagementCost(2,100,1,[NaN])).toThrow();});

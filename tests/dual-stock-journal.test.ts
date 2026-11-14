import { describe, expect, it } from "vitest";
import { assertDualJournal, writeJournal } from "../functions/src/accounting/write-journal";
import { stockJournalLines } from "../functions/src/accounting/stock-postings";
import { supplierReturnAmounts } from "../functions/src/inventory/supplier-return-calculations";
import { Timestamp } from "firebase-admin/firestore";

describe("dual stock journals", () => {
  it("balances distinct costs and exact opposite reversal in both bases", () => {
    const lines = stockJournalLines("stock_count_correction", true, 100, 175);
    expect(lines[1]).toMatchObject({debitMinor:100, managementDebitMinor:175});
    expect(() => assertDualJournal(lines)).not.toThrow();
    expect(() => assertDualJournal(lines.map(l=>({...l,debitMinor:l.creditMinor,creditMinor:l.debitMinor,managementDebitMinor:l.managementCreditMinor,managementCreditMinor:l.managementDebitMinor})))).not.toThrow();
  });
  it("retains zero-company, positive-management movements and inverse", () => {
    for (const [company,management] of [[0,75],[75,0]] as const) {
      const lines=stockJournalLines("stock_adjustment",true,company,management);
      expect(lines).toHaveLength(2);
      expect(()=>assertDualJournal(lines)).not.toThrow();
    }
  });
  it("falls back to company amounts for legacy callers", () => {
    expect(()=>assertDualJournal(stockJournalLines("opening_balance",false,100))).not.toThrow();
  });
  it("rejects unsafe, unbalanced or contradictory managerial lines", () => {
    for (const value of [-1,0.5,NaN,Number.MAX_SAFE_INTEGER+1]) expect(()=>stockJournalLines("stock_adjustment",true,1,value)).toThrow();
    const lines=stockJournalLines("stock_adjustment",true,100,175);
    expect(()=>assertDualJournal([{...lines[0]!,managementCreditMinor:174},lines[1]!])).toThrow();
    expect(()=>assertDualJournal([{...lines[0]!,managementDebitMinor:1},lines[1]!])).toThrow();
  });
  it("persists both bases including management-only ledger lines", () => {
    const created: Array<Record<string,unknown>>=[];
    const writer={create:(_ref:unknown,value:Record<string,unknown>)=>created.push(value),set:()=>{}};
    writeJournal(writer as never,{organizationId:"test",userId:"actor"} as never,{
      journal:{id:"journal"} as never,journalCounter:{} as never,journalCounterValue:1,journalType:"test",referenceType:"inventoryTransaction",referenceId:"movement",referenceNumber:"M1",description:"test",effectiveAt:Timestamp.now(),manageAccounts:false,lines:stockJournalLines("stock_adjustment",true,0,175)
    });
    expect(created[0]).toMatchObject({totalDebitMinor:0,totalCreditMinor:0,totalManagementDebitMinor:175,totalManagementCreditMinor:175});
    expect(created[1]).toMatchObject({debitMinor:0,creditMinor:0,managementDebitMinor:0,managementCreditMinor:175});
    expect(created[2]).toMatchObject({managementDebitMinor:175,managementCreditMinor:0});
  });
});


describe("supplier return dual valuation arithmetic", () => {
  it("balances AP/credit recovery against distinct carrying costs and signed variances", () => {
    for (const [company, management] of [[100,175],[175,100],[100,100],[0,175],[175,0]] as const) {
      const amount=supplierReturnAmounts({quantity:1,netMinor:100,vatMinor:5,returnedQuantity:0,returnedNetMinor:0,returnedVatMinor:0,returnQuantity:1,outstandingMinor:50,movementValueMinor:company});
      const variance=amount.netMinor-management;
      const lines=[
        {debitMinor:amount.payableReductionMinor,creditMinor:0},
        {debitMinor:amount.supplierCreditMinor,creditMinor:0},
        {debitMinor:0,creditMinor:company,managementDebitMinor:0,managementCreditMinor:management},
        {debitMinor:0,creditMinor:amount.vatMinor},
        {debitMinor:Math.max(0,-amount.valuationVarianceMinor),creditMinor:Math.max(0,amount.valuationVarianceMinor),managementDebitMinor:Math.max(0,-variance),managementCreditMinor:Math.max(0,variance)},
      ].filter(l=>l.debitMinor || l.creditMinor || l.managementDebitMinor || l.managementCreditMinor);
      expect(amount.payableReductionMinor+amount.supplierCreditMinor).toBe(105);
      expect(()=>assertDualJournal(lines)).not.toThrow();
      const reversal=lines.map(l=>({...l,debitMinor:l.creditMinor,creditMinor:l.debitMinor,managementDebitMinor:l.managementCreditMinor ?? l.creditMinor,managementCreditMinor:l.managementDebitMinor ?? l.debitMinor}));
      expect(()=>assertDualJournal(reversal)).not.toThrow();
      expect(reversal.reduce((sum,l)=>sum+l.managementDebitMinor-l.managementCreditMinor,0)).toBe(0);
    }
  });
});

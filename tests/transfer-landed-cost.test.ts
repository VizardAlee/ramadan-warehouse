import { describe, expect, it } from "vitest";
import { allocateTransport, receiptTransportShare, receiptCostBasis } from "../functions/src/branch-trading/landed-cost";

describe("landed cost arithmetic (not yet wired to live receipts)", () => {
  it("allocates by line value and conserves every kobo", () => {
    expect(allocateTransport(1001,[{id:"a",weight:100},{id:"b",weight:200}])).toEqual({a:334,b:667});
  });
  it("resolves ties by stable ID independent of order", () => {
    const rows=[{id:"c",weight:1},{id:"a",weight:1},{id:"b",weight:1}];
    expect(allocateTransport(2,rows)).toEqual({a:1,b:1,c:0});
    expect(allocateTransport(2,rows.reverse())).toEqual({a:1,b:1,c:0});
  });
  it("accepts only exact complete manual allocations", () => {
    const rows=[{id:"a",weight:0},{id:"b",weight:0}];
    expect(allocateTransport(7,rows,{a:2,b:5})).toEqual({a:2,b:5});
    for(const manual of ([{a:7},{a:2,b:4},{a:2,b:5,c:0},{a:-1,b:8}] as Record<string,number>[])) expect(()=>allocateTransport(7,rows,manual)).toThrow();
    expect(()=>allocateTransport(7,rows)).toThrow();
    expect(allocateTransport(0,rows)).toEqual({a:0,b:0});
  });
  it("handles safe amounts whose product exceeds floating point precision", () => {
    const max=Number.MAX_SAFE_INTEGER;
    const result=allocateTransport(max,[{id:"a",weight:max},{id:"b",weight:max}]);
    expect(BigInt(result.a!)+BigInt(result.b!)).toBe(BigInt(max));
    expect(result.a!-result.b!).toBe(1);
  });
  it("allocates partial and final receipts without repeatedly charging full transport", () => {
    expect([receiptTransportShare(10,3,0,1),receiptTransportShare(10,3,1,1),receiptTransportShare(10,3,2,1)]).toEqual([3,3,4]);
    expect(receiptTransportShare(10,3,0,3)).toBe(10);
    expect(receiptTransportShare(10,3,3,0)).toBe(0);
    expect(()=>receiptTransportShare(10,3,2,2)).toThrow();
    expect(()=>receiptTransportShare(10,0,0,0)).toThrow();
  });
  it("supports fractional merchandise via integral quantity ticks", () => {
    expect(receiptTransportShare(100,1000,0,125)).toBe(12);
    expect(receiptTransportShare(100,1000,125,875)).toBe(88);
  });
  it("keeps internal markup out of consolidated cost and avoids duplicate transport debt", () => {
    const values={companyCarryingMinor:10000,agreedTransferMinor:12000,externalTransportMinor:1000};
    expect(receiptCostBasis({...values,transportPayer:"source"})).toEqual({companyLandedMinor:11000,branchLandedMinor:13000,supplierLiabilityMinor:13000,directTransportLiabilityMinor:0,internalMarkupMinor:2000});
    expect(receiptCostBasis({...values,transportPayer:"destination"})).toEqual({companyLandedMinor:11000,branchLandedMinor:13000,supplierLiabilityMinor:12000,directTransportLiabilityMinor:1000,internalMarkupMinor:2000});
    expect(receiptCostBasis({...values,agreedTransferMinor:9000,transportPayer:"source"}).internalMarkupMinor).toBe(-1000);
  });
  it.each([-1,0.1,Infinity,NaN,Number.MAX_SAFE_INTEGER+1])("rejects invalid amounts %s", value => {
    expect(()=>allocateTransport(value,[{id:"a",weight:1}])).toThrow();
    expect(()=>receiptTransportShare(value,1,0,1)).toThrow();
    expect(()=>receiptCostBasis({companyCarryingMinor:value,agreedTransferMinor:0,externalTransportMinor:0,transportPayer:"source"})).toThrow();
  });
  it("rejects duplicate IDs and overflowing resulting valuation", () => {
    expect(()=>allocateTransport(1,[{id:"a",weight:1},{id:"a",weight:1}])).toThrow();
    expect(()=>receiptCostBasis({companyCarryingMinor:Number.MAX_SAFE_INTEGER,agreedTransferMinor:0,externalTransportMinor:1,transportPayer:"source"})).toThrow();
  });
  it("exhaustively conserves allocation and partial receipt amounts for small cases", () => {
    for(let amount=0;amount<80;amount++) for(let quantity=1;quantity<20;quantity++) {
      let total=0;
      for(let received=0;received<quantity;received++) total+=receiptTransportShare(amount,quantity,received,1);
      expect(total).toBe(amount);
      const allocation=allocateTransport(amount,[{id:"a",weight:quantity},{id:"b",weight:quantity+1},{id:"c",weight:quantity+2}]);
      expect(Object.values(allocation).reduce((a,b)=>a+b,0)).toBe(amount);
    }
  });
});

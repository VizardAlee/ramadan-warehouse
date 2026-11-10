import { describe, expect, it } from "vitest";
import { internalTradeSupplier } from "../functions/src/branch-trading/identity";
describe("internal trade supplier identity", () => {
  const config = {headOfficeBranchId:"hq",headOfficeSupplyWarehouseId:"central"};
  it("supports every directional branch pair without requiring HQ configuration", () => {
    for (const from of ["hq","north","south"]) for (const to of ["hq","north","south"]) {
      expect(internalTradeSupplier({}, {type:"branch",branchId:from}, {type:"branch",branchId:to})).toBe(from === to ? null : from);
    }
  });
  it("preserves configured HQ warehouse supplies and excludes unrelated warehouses", () => {
    expect(internalTradeSupplier(config,{type:"warehouse",warehouseId:"central"},{type:"branch",branchId:"north"})).toBe("hq");
    expect(internalTradeSupplier(config,{type:"warehouse",warehouseId:"other"},{type:"branch",branchId:"north"})).toBeNull();
    expect(internalTradeSupplier(config,{type:"warehouse",warehouseId:"central"},{type:"branch",branchId:"hq"})).toBeNull();
    expect(internalTradeSupplier({}, {type:"warehouse",warehouseId:"central"},{type:"branch",branchId:"north"})).toBeNull();
  });
  it("rejects absent identities and non-branch destinations", () => {
    expect(internalTradeSupplier(config,{type:"branch"},{type:"branch",branchId:"north"})).toBeNull();
    expect(internalTradeSupplier(config,{type:"branch",branchId:"north"},{type:"warehouse",warehouseId:"central"})).toBeNull();
  });
});

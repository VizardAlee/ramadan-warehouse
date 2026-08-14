import { describe, expect, it } from "vitest";
import { summarizeDashboard } from "@/features/dashboard/summary";
import type { BranchRequest, Product, WarehouseTransfer } from "@/types/domain";

describe("dashboard summary", () => {
  it("counts only active and operational records returned by scoped registers", () => {
    const requests = [
      { status: "approved" },
      { status: "fulfilled" },
      { status: "rejected" },
    ] as BranchRequest[];
    const transfers = [
      { status: "picking" },
      { status: "disputed" },
      { status: "closed" },
    ] as WarehouseTransfer[];
    const products = [{ active: true }, { active: false }] as Product[];

    expect(summarizeDashboard(requests, transfers, products)).toEqual({
      requests: 1,
      transfers: 2,
      products: 1,
      discrepancies: 1,
    });
  });
});

import { describe, expect, it } from "vitest";
import {
  scopeDashboardRecords,
  summarizeDashboard,
  summarizeTransferPipeline,
} from "@/features/dashboard/summary";
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

  it("groups active transfers into dashboard pipeline stages", () => {
    const transfers = [
      { status: "under_review" },
      { status: "reserved" },
      { status: "packing" },
      { status: "dispatched" },
      { status: "disputed" },
      { status: "closed" },
      { status: "cancelled" },
    ] as WarehouseTransfer[];

    expect(summarizeTransferPipeline(transfers)).toEqual([
      { label: "Review", value: 1 },
      { label: "Preparation", value: 2 },
      { label: "In transit", value: 1 },
      { label: "Receiving & issues", value: 1 },
    ]);
  });

  it("filters dashboard records without changing authorization", () => {
    const requests = [
      { branchId: "branch-1" },
      { branchId: "branch-2" },
    ] as BranchRequest[];
    const transfers = [
      { originWarehouseId: "warehouse-1", destinationBranchId: "branch-1" },
      { originWarehouseId: "warehouse-2", destinationBranchId: "branch-2" },
    ] as WarehouseTransfer[];

    expect(
      scopeDashboardRecords(requests, transfers, {
        type: "branch",
        id: "branch-2",
      }),
    ).toEqual({ requests: [requests[1]], transfers: [transfers[1]] });
    expect(
      scopeDashboardRecords(requests, transfers, {
        type: "warehouse",
        id: "warehouse-1",
      }),
    ).toEqual({ requests, transfers: [transfers[0]] });
  });
});

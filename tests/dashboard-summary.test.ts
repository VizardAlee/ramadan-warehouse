import { describe, expect, it } from "vitest";
import {
  scopeDashboardRecords,
  summarizeDashboard,
  summarizeSales,
  summarizeSalesByDay,
  summarizeSalesPaymentMix,
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

  it("summarizes sales value, credit, discounts, and daily charts", () => {
    const sales = [
      {
        id: "sale-1",
        recordedAt: "2026-09-19T10:00:00.000Z",
        grossAmountMinor: 107_500,
        amountPaidMinor: 107_500,
        creditAmountMinor: 0,
        vatAmountMinor: 7_500,
        discountAmountMinor: 5_000,
        totalQuantity: 2,
      },
      {
        id: "sale-2",
        recordedAt: "2026-09-20T10:00:00.000Z",
        grossAmountMinor: 215_000,
        amountPaidMinor: 100_000,
        creditAmountMinor: 115_000,
        vatAmountMinor: 15_000,
        discountAmountMinor: 0,
        totalQuantity: 3,
      },
    ];
    expect(summarizeSales(sales)).toEqual({
      saleCount: 2,
      grossAmountMinor: 322_500,
      amountPaidMinor: 207_500,
      creditAmountMinor: 115_000,
      vatAmountMinor: 22_500,
      discountAmountMinor: 5_000,
      totalQuantity: 5,
    });
    expect(
      summarizeSalesByDay(sales, 2, new Date("2026-09-20T12:00:00.000Z")),
    ).toMatchObject([
      { date: "2026-09-19", value: 107_500, count: 1 },
      { date: "2026-09-20", value: 215_000, count: 1 },
    ]);
    expect(summarizeSalesPaymentMix(sales)).toMatchObject([
      { label: "Paid in full", value: 1 },
      { label: "Part-paid", value: 1 },
      { label: "On credit", value: 0 },
    ]);
  });
});

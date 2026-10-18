// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WarehouseTransfer } from "../src/types/domain";

const state = vi.hoisted(() => ({ call: vi.fn(), role: "warehouse_manager" }));
vi.mock("@/features/administration/api", () => ({ callAdministration: state.call }));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => ({ profile: { status: "active", roleId: state.role, roleIds: [state.role] }, accessProfile: null, operatingContext: { type: state.role === "branch_manager" ? "branch" : "warehouse", id: "location" } }) }));
import { TransferOperations } from "../src/features/transfers/transfer-operations";
import { goodDispatchReceipt } from "../src/features/transfers/legacy-stock-actions";

beforeEach(() => { state.role = "warehouse_manager"; state.call.mockReset(); state.call.mockResolvedValue({ receiptId: "new-receipt" }); });
afterEach(cleanup);
describe("guided stock confirmation recovery", () => {
  it("resumes the original dispatch instead of creating another document", async () => {
    const saved = { transferId: "transfer", dispatchId: "original-dispatch", expectedVersion: 1, packageIds: ["package"], driverName: "Original driver" };
    const transfer = { id: "transfer", status: "ready_for_dispatch", version: 1, activeStockExecutionId: "execution", activeStockExecutionKind: "dispatch", activeStockExecutionEntityId: "original-dispatch", activeStockExecutionInput: saved } as unknown as WarehouseTransfer;
    const onComplete = vi.fn().mockResolvedValue(undefined);
    render(<TransferOperations transfer={transfer} items={[]} reservations={[]} packages={[]} dispatches={[]} online onComplete={onComplete} />);
    expect(screen.queryByRole("button", { name: "Confirm dispatch" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Resume saved dispatch" }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
    expect(state.call).toHaveBeenCalledExactlyOnceWith("confirmTransferDispatch", { ...saved, idempotencyKey: expect.any(String) });
  });

  it("receives only the selected dispatch even when transfer totals include other dispatches", async () => {
    state.role = "branch_manager";
    const transfer = { id: "transfer", status: "partially_dispatched", version: 1 } as WarehouseTransfer;
    const manifests = [
      { dispatchId: "dispatch-a", transferItemId: "item", productId: "product", trackingType: "quantity", quantity: 2, allocationVersion: 2 },
      { dispatchId: "dispatch-b", transferItemId: "item", productId: "product", trackingType: "quantity", quantity: 8, allocationVersion: 2 },
    ];
    const onComplete = vi.fn().mockResolvedValue(undefined);
    render(<TransferOperations transfer={transfer} items={[]} reservations={[]} packages={[]} dispatches={[{ id: "dispatch-a", status: "in_transit" }, { id: "dispatch-b", status: "in_transit" }]} dispatchItems={manifests} online onComplete={onComplete} />);
    fireEvent.click(screen.getByRole("button", { name: "Receive all in good condition" }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
    expect(state.call.mock.calls[0]).toEqual(["createTransferReceipt", expect.objectContaining({ dispatchId: "dispatch-a", lines: [expect.objectContaining({ transferItemId: "item", receivedQuantity: 2 })] })]);
    expect(state.call.mock.calls[1]).toEqual(["confirmTransferReceipt", expect.objectContaining({ receiptId: "new-receipt", lines: [expect.objectContaining({ receivedQuantity: 2 })] })]);
  });

  it("does not guess guided receipt quantities without exact manifests or tracked claims", () => {
    expect(goodDispatchReceipt("old-dispatch", [], []).review).toContain("review");
    const manifest = { dispatchId: "dispatch", transferItemId: "item", trackingType: "serial", quantity: 2, serialItemIds: ["one", "two"], allocationVersion: 2 };
    expect(goodDispatchReceipt("dispatch", [manifest], [{ dispatchId: "dispatch", transferItemId: "item", claimedQuantity: 1 }]).lines).toEqual([]);
    expect(goodDispatchReceipt("dispatch", [manifest], [{ dispatchId: "dispatch", transferItemId: "item", claimedQuantity: 1, allocationVersion: 2, claimedSerialItemIds: ["one"] }]).lines).toMatchObject([{ receivedQuantity: 1, serialItemIds: ["two"] }]);
  });
});

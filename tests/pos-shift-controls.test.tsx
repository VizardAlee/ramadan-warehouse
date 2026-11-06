// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PosActiveShift, PosShiftAccess } from "@/features/pos/shift-controls";
import type { PosShift } from "@/features/pos/types";
vi.mock("@/features/finance/financial-privacy", () => ({ FinancialText: ({children}: {children: React.ReactNode}) => <>{children}</>, FinancialActionScope: ({children}: {children: React.ReactNode}) => <>{children}</>, FinancialAction: ({children}: {children: React.ReactNode}) => <>{children}</>, FinancialInput: ({children}: {children: React.ReactNode}) => <>{children}</> }));
afterEach(cleanup);
it("shows blocked-shift ownership guidance and current account without offering an opening-cash instruction", () => {
  const open = vi.fn(), retry = vi.fn();
  render(<PosShiftAccess recovery={{status:"other_user",message:"This device has an open shift under another account."}} account="current@example.test" online busy={false} canManage openingCash="0" onOpeningCash={vi.fn()} onOpen={open} onRetry={retry} />);
  expect(screen.getByRole("heading", {name:"Existing device shift requires review"})).toBeTruthy();
  expect(screen.getByText("current@example.test")).toBeTruthy();
  expect(screen.queryByLabelText("Opening cash (₦)")).toBeNull();
  expect(screen.queryByRole("button", {name:"Open shift and start selling"})).toBeNull();
  expect(screen.getByText(/Different devices can run separate cashier shifts/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", {name:"Retry device shift"}));
  expect(retry).toHaveBeenCalledTimes(1); expect(open).not.toHaveBeenCalled();
});
it("does not offer new shift creation without the existing shift-management permission", () => {
  render(<PosShiftAccess account="staff@example.test" online busy={false} canManage={false} openingCash="0" onOpeningCash={vi.fn()} onOpen={vi.fn()} onRetry={vi.fn()} />);
  expect(screen.getByRole("heading", {name:"A cashier shift is required"})).toBeTruthy();
  expect(screen.queryByRole("button", {name:"Open shift and start selling"})).toBeNull();
});
const shift = { id:"own-shift", deviceId:"own-device", deviceName:"Cashier desk" } as PosShift;
it("exposes separate authorized shift-close controls and keeps a pending order blocked", () => {
  const close = vi.fn();
  const props = { shift, account:"cashier@example.test", canManage:true, online:true, busy:false, pendingOrder:true, closingCash:"0", onClosingCash:vi.fn(), onClose:close };
  const view = render(<PosActiveShift {...props} />);
  fireEvent.click(screen.getByText("Close shift", {exact:true}));
  expect(screen.getByRole("button", {name:"Close and reconcile shift"}).hasAttribute("disabled")).toBe(true);
  view.rerender(<PosActiveShift {...props} pendingOrder={false} />);
  fireEvent.click(screen.getByRole("button", {name:"Close and reconcile shift"}));
  expect(close).toHaveBeenCalledTimes(1);
  view.rerender(<PosActiveShift {...props} pendingOrder={false} canManage={false} />);
  expect(screen.queryByText("Close shift", {exact:true})).toBeNull();
});

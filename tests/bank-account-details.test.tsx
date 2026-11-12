// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BankAccountDetails } from "@/features/banking/bank-account-details";
import type { BankAccount } from "@/types/domain";
const api = vi.hoisted(() => vi.fn());
vi.mock("@/features/administration/api", () => ({ callAdministration: api }));
const account: BankAccount = { id: "bank-a", organizationId: "org", bankName: "Fidelity", accountName: "Existing company", accountNumberLast4: "8802", ledgerAccountCode: "1032", openingBalanceMinor: 0, openingDate: "2026-11-12", active: true, lifecycleStatus: "active", currency: "NGN", branchId: "rumfar" };
const onSaved = vi.fn();
const setup = () => render(<BankAccountDetails account={account} canManage onSaved={onSaved} />);
function edit() { fireEvent.click(screen.getByRole("button", { name: "Edit bank details" })); }
beforeEach(() => { api.mockReset(); onSaved.mockReset(); });
afterEach(cleanup);
it("updates an existing ID while retaining ledger, reference and lifecycle; never changes owner", async () => {
  api.mockResolvedValue({ bankAccountId: account.id }); setup(); edit();
  fireEvent.change(screen.getByLabelText("Bank name"), { target: { value: " FCMB " } });
  fireEvent.change(screen.getByLabelText("Account name"), { target: { value: "AB RAMADAN ELECTRIC AND ELECTRONICS" } });
  fireEvent.click(screen.getByRole("button", { name: "Save bank details" }));
  await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
  expect(api).toHaveBeenCalledWith("saveBankAccount", { bankAccountId: account.id, bankName: "FCMB", accountName: "AB RAMADAN ELECTRIC AND ELECTRONICS", accountNumberLast4: "8802", ledgerAccountCode: "1032", openingBalanceMinor: 0, openingDate: "2026-11-12", active: true });
  expect(await screen.findByText(/Bank details updated/)).toBeTruthy(); expect(onSaved).toHaveBeenCalledTimes(1);
});
it("does not expose edits without permission or for an archived account", () => {
  const view = render(<BankAccountDetails account={account} canManage={false} onSaved={onSaved} />);
  expect(screen.queryByRole("button")).toBeNull();
  view.rerender(<BankAccountDetails account={{ ...account, active: false }} canManage onSaved={onSaved} />);
  expect(screen.queryByRole("button")).toBeNull(); expect(api).not.toHaveBeenCalled();
});
it("blocks a stale loading workspace or a selected branch", () => {
  const view = render(<BankAccountDetails account={account} canManage allLocations={false} onSaved={onSaved} />);
  expect((screen.getByRole("button", { name: "Edit bank details" }) as HTMLButtonElement).disabled).toBe(true);
  view.rerender(<BankAccountDetails account={account} canManage disabled onSaved={onSaved} />);
  expect((screen.getByRole("button", { name: "Edit bank details" }) as HTMLButtonElement).disabled).toBe(true);
});
it("cancel discards changes and unchanged/invalid fields cannot save", () => {
  setup(); edit(); expect((screen.getByRole("button", { name: "Save bank details" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Bank name"), { target: { value: "X" } });
  expect((screen.getByRole("button", { name: "Save bank details" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" })); edit();
  expect((screen.getByLabelText("Bank name") as HTMLInputElement).value).toBe("Fidelity"); expect(api).not.toHaveBeenCalled();
});
it("blocks repeated submits and requires refresh after an uncertain result", async () => {
  let reject!: (cause: Error) => void;
  api.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
  setup(); edit(); fireEvent.change(screen.getByLabelText("Bank name"), { target: { value: "FCMB" } });
  const form = screen.getByRole("button", { name: "Save bank details" }).closest("form")!;
  fireEvent.submit(form); fireEvent.submit(form); expect(api).toHaveBeenCalledTimes(1);
  reject(new Error("Connection lost")); await screen.findByRole("alert");
  expect((screen.getByRole("button", { name: "Save bank details" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Refresh account details" })); expect(onSaved).toHaveBeenCalledTimes(1);
});
it("does not reload an old account after navigating away during a save", async () => {
  let resolve!: (value: object) => void;
  api.mockImplementation(() => new Promise(done => { resolve = done; }));
  const view = setup(); edit(); fireEvent.change(screen.getByLabelText("Bank name"), { target: { value: "FCMB" } });
  fireEvent.click(screen.getByRole("button", { name: "Save bank details" }));
  view.unmount(); resolve({ bankAccountId: account.id });
  await new Promise(done => setTimeout(done, 0)); expect(onSaved).not.toHaveBeenCalled();
});

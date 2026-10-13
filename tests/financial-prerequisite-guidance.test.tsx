// @vitest-environment jsdom
import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {ServicePayments} from "@/features/returns/service-payments";
import {BillingControls} from "@/features/accounting/billing-controls";
import {CompanyFundsTransfer} from "@/features/banking/company-funds-transfer";
import type {BankAccount} from "@/types/domain";
const mocks=vi.hoisted(()=>({call:vi.fn(),run:vi.fn()}));
vi.mock("@/features/administration/api",()=>({callAdministration:mocks.call}));
vi.mock("@/features/accounting/use-billing-operation",()=>({useBillingOperation:()=>({ready:true,busy:false,pending:null,error:"",run:mocks.run})}));
beforeEach(()=>{mocks.call.mockReset();mocks.run.mockReset();sessionStorage.clear();});
afterEach(()=>cleanup());
describe("actual financial prerequisite explanations preserve guards",()=>{
 it("distinguishes missing service payout account and excessive original-receipt refund",async()=>{
  mocks.call.mockResolvedValue({payments:[{id:"receipt",entryType:"receipt",amountMinor:100000,refundedAmountMinor:0,recordedAt:"2026-10-01T10:00:00Z",method:"cash",journalEntryId:"journal"}],nextCursor:null});
  const refund=vi.fn();render(<ServicePayments caseId="synthetic" canRefund disabled={false} accounts={[]} onRefund={refund}/>);
  fireEvent.click(screen.getByText("Receipts & refunds"));
  fireEvent.click(await screen.findByRole("button",{name:"Refund receipt"}));
  expect(screen.getByText(/actual refund reason, at least 5/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Refund reason"),{target:{value:"Actual returned payment"}});
  fireEvent.change(screen.getByLabelText("Refund method"),{target:{value:"bank_transfer"}});
  expect(screen.getByText(/No active payout account/)).toBeTruthy();
  expect(screen.getByRole("button",{name:"Confirm receipt refund"}).hasAttribute("disabled")).toBe(true);
  fireEvent.change(screen.getByLabelText("Refund method"),{target:{value:"cash"}});
  fireEvent.change(screen.getByLabelText("Refund amount (₦)"),{target:{value:"2000"}});
  expect(screen.getByText(/Refund cannot exceed this receipt/)).toBeTruthy();
  expect(refund).not.toHaveBeenCalled();expect(mocks.call).toHaveBeenCalledTimes(1);
 });
 it("explains absent reviewed mappings rather than sending another financial proposal",async()=>{
  mocks.call.mockResolvedValue({mapping:null,accounts:[]});render(<BillingControls ownerKey="synthetic"/>);
  await screen.findByText(/No eligible ledger accounts/);
  expect(screen.getByRole("button",{name:"Save reviewed account mappings"}).hasAttribute("disabled")).toBe(true);
  expect(mocks.run).not.toHaveBeenCalled();
 });
 it("identifies the actual missing mapping field and enables only after the reviewed pair and reason",async()=>{
  mocks.call.mockResolvedValue({mapping:null,accounts:[{id:"a",code:"2301",name:"Reviewed service",purpose:null},{id:"b",code:"2302",name:"Reviewed provider",purpose:null}]});render(<BillingControls ownerKey="synthetic"/>);
  await screen.findByText(/Choose the reviewed deferred-service/);
  fireEvent.change(screen.getByLabelText("Deferred service control"),{target:{value:"a"}});
  fireEvent.change(screen.getByLabelText("Provider funds payable"),{target:{value:"b"}});
  expect(screen.getByText(/review reason, at least 5/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Review reason"),{target:{value:"Accountant reviewed"}});
  expect(screen.getByRole("button",{name:"Save reviewed account mappings"}).hasAttribute("disabled")).toBe(false);
  expect(mocks.run).not.toHaveBeenCalled();
 });
 it("requires two actual active accounts and does not initiate a bank movement",async()=>{
  render(<CompanyFundsTransfer accounts={[{id:"one",active:true,bankName:"Synthetic bank",accountName:"Example",accountNumberLast4:"0000"} as BankAccount]} branchId="synthetic" ownerKey="test" onComplete={vi.fn()}/>);
  fireEvent.click(screen.getByText("Transfer between company accounts"));
  await screen.findByText(/Two distinct active company accounts/);
  expect(screen.getByRole("button",{name:"Record completed transfer"}).hasAttribute("disabled")).toBe(true);
  expect(mocks.call).not.toHaveBeenCalled();
 });
});

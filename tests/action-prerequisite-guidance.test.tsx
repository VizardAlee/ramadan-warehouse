// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionGuidanceProvider, WorkspacePrerequisites } from "@/features/guidance/action-guidance";
import { Button } from "@/components/ui/button";
import { prerequisiteForAction } from "@/features/guidance/action-prerequisites";
import {CloseBlockerGuidance} from "@/features/guidance/close-blocker-guidance";
import type { UserProfile } from "@/types/domain";
import {salesWorkflowSteps} from "@/features/guidance/workflows";
import UserGuide from "@/app/(protected)/guide/page";
const state=vi.hoisted(()=>({profile:{status:"active",roleId:"operations_administrator",roleIds:["operations_administrator"],effectivePermissions:["user.manage","products.read"]}}));
vi.mock("@/features/auth/auth-context",()=>({useAuth:()=>state}));
const cashier={status:"active",roleId:"sales_cashier",roleIds:["sales_cashier"]} as UserProfile;
const admin={status:"active",roleId:"system_administrator",roleIds:["system_administrator"]} as UserProfile;
afterEach(()=>cleanup());
describe("visible prerequisite guidance without changing authority",()=>{
 it("puts readable funding steps beside a disabled payment, hides inaccessible setup links and clears after enabling",async()=>{
  const view=render(<ActionGuidanceProvider pathname="/expenses" profile={cashier}><Button disabled>Record payment</Button></ActionGuidanceProvider>);
  const button=screen.getByRole("button",{name:"Record payment"});
  expect(button.hasAttribute("disabled")).toBe(true);
  const id=button.getAttribute("aria-describedby");expect(id).toBeTruthy();expect(document.getElementById(id!)?.textContent).toContain("within outstanding");
  expect(screen.queryByRole("link",{name:"Review company accounts"})).toBeNull();
  view.rerender(<ActionGuidanceProvider pathname="/expenses" profile={cashier}><Button>Record payment</Button></ActionGuidanceProvider>);
  await waitFor(()=>expect(screen.queryByText(/Choose the actual allocation/)).toBeNull());
  expect(button.hasAttribute("disabled")).toBe(false);
 });
 it("keeps requirements beside an enabled action after rejection without exposing protected state",async()=>{
  render(<ActionGuidanceProvider pathname="/expenses" profile={cashier}><Button>Record payment</Button></ActionGuidanceProvider>);
  const button=screen.getByRole("button",{name:"Record payment"});expect(button.hasAttribute("disabled")).toBe(false);
  expect(button.getAttribute("aria-describedby")).toBeNull();
  const summary=screen.getByText("Action requirements");const details=summary.closest("details")!;
  details.open=true;fireEvent(details,new Event("toggle"));
  await screen.findByText(/This browser cannot inspect protected records/);
  expect(screen.queryByRole("link",{name:"Review company accounts"})).toBeNull();
 });
 it("describes supported online serialized POS without claiming unavailable checkout",()=>{
  render(<UserGuide/>);
  expect(screen.queryByText(/Serialized-product POS sales remain unavailable/)).toBeNull();
  expect(salesWorkflowSteps.some(step=>step.detail.includes("at most 50 serials per order"))).toBe(true);
 });
 it("handles native fieldset blockers and exposes a permitted setup destination",async()=>{
  const view=render(<ActionGuidanceProvider pathname="/finance" profile={admin}><fieldset disabled><Button>Post balanced journal</Button></fieldset></ActionGuidanceProvider>);
  await screen.findByText(/Select the responsible store, date/);
  expect(screen.getByRole("link",{name:"Review company accounts"}).getAttribute("href")).toBe("/banking");
  view.rerender(<ActionGuidanceProvider pathname="/finance" profile={admin}><fieldset><Button>Post balanced journal</Button></fieldset></ActionGuidanceProvider>);
  await waitFor(()=>expect(screen.queryByText(/Select the responsible store, date/)).toBeNull());
 });
 it("provides keyboard-openable help for hidden permission/state actions without querying business data",()=>{
  render(<ActionGuidanceProvider pathname="/procurement" profile={cashier}><WorkspacePrerequisites/><Button disabled>Create draft order</Button></ActionGuidanceProvider>);
  const summary=screen.getByText("Help for unavailable actions");expect(summary.tagName).toBe("SUMMARY");fireEvent.click(summary);
  expect(screen.getAllByText(/Select an active supplier/).length).toBeGreaterThan(0);
  expect(screen.queryByRole("link",{name:"Review company accounts"})).toBeNull();
 });
 it("skips ordinary first/last-page controls while covering key stock, tax and employee actions",()=>{
  expect(prerequisiteForAction("/reports","Next page")).toBeUndefined();
  expect(prerequisiteForAction("/inventory/counts","Create draft")?.instruction).toContain("assigned counter");
  expect(prerequisiteForAction("/tax","Preview tax calculation")?.instruction).toContain("approved verified rule");
  expect(prerequisiteForAction("/hr","Record event")?.instruction).toContain("loaded employee page");
 });
 it("uses the most specific action and covers statement/provider/held-goods labels",()=>{
  expect(prerequisiteForAction("/procurement","Approve invoice")?.instruction).toContain("supplier invoice");
  expect(prerequisiteForAction("/requests","Cancel request")?.instruction).toContain("every unit");
  expect(prerequisiteForAction("/requests","Cancel")).toBeUndefined();
  expect(prerequisiteForAction("/expenses","Record provider payment")).toBeTruthy();
  expect(prerequisiteForAction("/customers/example","Export complete statement")?.instruction).toContain("opening balances");
  expect(prerequisiteForAction("/aftersales","Confirm replacement receipt")?.instruction).toContain("held goods");
  expect(prerequisiteForAction("/hr","Save employee")?.instruction).not.toContain("Select the employee");
 });
 it("shows no setup warning during explicitly busy or spinning processing",()=>{
  const view=render(<ActionGuidanceProvider pathname="/expenses" profile={cashier}><Button disabled aria-busy>Record payment</Button></ActionGuidanceProvider>);
  expect(screen.queryByText(/Choose the actual allocation/)).toBeNull();
  view.rerender(<ActionGuidanceProvider pathname="/expenses" profile={cashier}><Button disabled><span className="animate-spin"/>Record payment</Button></ActionGuidanceProvider>);
  expect(screen.queryByText(/Choose the actual allocation/)).toBeNull();
  expect(screen.getByRole("button",{name:"Record payment"}).hasAttribute("disabled")).toBe(true);
 });
 it("keeps the same actionable DOM button when an explicit blocker clears",()=>{
  const click=vi.fn();const view=render(<Button disabled disabledReason="Select the actual account" onClick={click}>Record payment</Button>);
  const original=screen.getByRole("button",{name:"Record payment"});
  view.rerender(<Button disabled={false} disabledReason={undefined} onClick={click}>Record payment</Button>);
  expect(screen.getByRole("button",{name:"Record payment"})).toBe(original);
  fireEvent.click(original);expect(click).toHaveBeenCalledTimes(1);
 });
 it("delegates a month-close bank blocker without exposing an inaccessible source",()=>{
  const view=render(<CloseBlockerGuidance code="BANK_RECONCILIATION_REQUIRED" profile={cashier}/>);
  expect(screen.getByText(/exact month's real account evidence/)).toBeTruthy();expect(screen.queryByRole("link")).toBeNull();
  view.rerender(<CloseBlockerGuidance code="BANK_RECONCILIATION_REQUIRED" profile={admin}/>);
  expect(screen.getByRole("link",{name:"Review bank reconciliations"}).getAttribute("href")).toBe("/banking");
 });
 it("shows a first-unmet explicit reason without enabling the button",()=>{
  render(<Button disabled disabledReason="No eligible counter. Ask an administrator to assign an active stock counter.">Create draft</Button>);
  expect(screen.getByText(/No eligible counter/)).toBeTruthy();
  expect(screen.getByRole("button",{name:"Create draft"}).hasAttribute("disabled")).toBe(true);
 });
 it("does not send user-only administrators to Roles, product setup or opening stock from the guide",()=>{
  render(<UserGuide/>);
  expect(screen.queryByRole("link",{name:"Roles & permissions"})).toBeNull();
  expect(screen.queryAllByRole("link").some(link=>["/administration/roles","/inventory/opening-stock","/products"].includes(link.getAttribute("href")??""))).toBe(false);
  expect(screen.getAllByText(/ask a system administrator/).length).toBeGreaterThan(0);
 });
});


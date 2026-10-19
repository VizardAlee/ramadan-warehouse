// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useRef, useState, type ReactNode } from "react";
import { FinancialAction, FinancialActionScope, FinancialInput, FinancialPrivacyProvider, FinancialValue, privacyStorageKey } from "@/features/finance/financial-privacy";
import { FinancialPrivacyToggle } from "@/features/finance/financial-privacy-toggle";
import { CompanyFundsTransfer } from "@/features/banking/company-funds-transfer";
import { JournalWorkspace } from "@/features/accounting/journal-workspace";
import BankingPage from "@/app/(protected)/banking/page";
import { ProviderFunds } from "@/features/accounting/provider-funds";
import type { BankAccount } from "@/types/domain";
const api = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({ user: { uid: "user" }, profile: { uid: "user", organizationId: "org", status: "active", roleId: "system_administrator", roleIds: ["system_administrator"], branchIds: ["store"], warehouseIds: [] }, operatingContext: { type: "branch", id: "store" } }));
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => auth }));
vi.mock("@/features/administration/api", () => ({ callAdministration: api }));
const key = privacyStorageKey("org", "user");
const banks = ["a", "b"].map(id => ({ id, active: true, bankName: "Bank", accountName: id, accountNumberLast4: "1234" })) as BankAccount[];
function Workspace({ children }: { children: ReactNode }) { return <FinancialPrivacyProvider organizationId="org" uid="user"><FinancialPrivacyToggle />{children}</FinancialPrivacyProvider>; }
async function ready() { await waitFor(() => expect((screen.getByRole("button", { name: "Hide financial values" }) as HTMLButtonElement).disabled).toBe(false)); }
function toggle() { fireEvent.click(screen.getByRole("button", { name: "Hide financial values" })); }
function showInitially() { localStorage.setItem(key, '{"version":1,"hidden":false}'); }
function review(element: HTMLElement) { const scope = element.closest<HTMLElement>("[data-financial-action-scope]")!; fireEvent.click(within(scope).getAllByRole("button", { name: "Review all action amounts", hidden: true })[0]!); }
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("refuses a retained transfer before persistence, then posts its exact amount after local review", async () => {
  showInitially(); api.mockResolvedValue({ journalNumber: "JRN-1", referenceNumber: "FTR-1" });
  render(<Workspace><CompanyFundsTransfer accounts={banks} branchId="store" ownerKey="org:user" onComplete={vi.fn()} /></Workspace>); await ready();
  await waitFor(() => expect((screen.getByLabelText("From company account").closest("fieldset") as HTMLFieldSetElement).disabled).toBe(false));
  for (const [label, value] of [["From company account", "a"], ["To company account", "b"], ["Amount (₦)", "2500.51"], ["Date money moved", "2026-10-09T09:00"], ["Bank transfer reference", "BANK-001"], ["Reason", "Move company reserve"]]) fireEvent.change(screen.getByLabelText(label!), { target: { value } });
  fireEvent.click(screen.getByRole("checkbox")); toggle();
  const button = screen.getByRole("button", { name: "Record completed transfer", hidden: true });
  fireEvent.click(button); expect(api).not.toHaveBeenCalled(); expect(sessionStorage.getItem("abr-pending-company-transfer:org:user")).toBeNull();
  expect(screen.getByText("Nothing was submitted. Your entered amounts are retained.")).toBeTruthy();
  review(button); expect((screen.getByLabelText("Amount (₦)") as HTMLInputElement).value).toBe("2500.51");
  expect(screen.getByRole("button", { name: "Hide financial values" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(button); await waitFor(() => expect(api).toHaveBeenCalledOnce());
  expect(api.mock.calls[0]).toEqual(["recordCompanyFundsTransfer", expect.objectContaining({ amountMinor: 250051, sourceBankAccountId: "a", destinationBankAccountId: "b", branchId: "store", reference: "BANK-001", confirmedCompleted: true, idempotencyKey: expect.any(String) })]);
  expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ version: 1, hidden: true });
});

it("retries only the immutable saved transfer while amounts remain hidden", async () => {
  const saved = { sourceBankAccountId: "a", destinationBankAccountId: "b", branchId: "original-store", amountMinor: 250051, transferredAt: "2026-10-09T09:00:00.000Z", reference: "BANK-001", reason: "Move company reserve", confirmedCompleted: true, idempotencyKey: "saved-transfer-key" };
  sessionStorage.setItem("abr-pending-company-transfer:org:user", JSON.stringify(saved)); api.mockResolvedValue({ journalNumber: "JRN-1", referenceNumber: "FTR-1" });
  render(<Workspace><CompanyFundsTransfer accounts={banks} branchId="other-store" ownerKey="org:user" onComplete={vi.fn()} /></Workspace>); await ready();
  fireEvent.click(await screen.findByRole("button", { name: "Retry saved transfer" })); await waitFor(() => expect(api).toHaveBeenCalledWith("recordCompanyFundsTransfer", saved));
  expect(screen.getByRole("button", { name: "Hide financial values" }).getAttribute("aria-pressed")).toBe("true");
});

const journalWorkspace = { entries: [], nextCursorId: null, bankAccounts: [], accounts: [{ id: "expense", code: "6100", name: "Depreciation", active: true }, { id: "asset", code: "1590", name: "Accumulated depreciation", active: true }] };
const journalProps = { ownerKey: "org:user", branchId: "store", canCreate: true, canReverse: false, canManageAccounts: false };
it("blocks hidden journal instructions before saving a key and preserves reviewed balanced minor units", async () => {
  showInitially(); api.mockImplementation(async (_name, input) => input.action === "workspace" ? journalWorkspace : { journalNumber: "JRN-1" });
  render(<Workspace><JournalWorkspace {...journalProps} /></Workspace>); await ready();
  await waitFor(() => expect((screen.getByLabelText("Date").closest("fieldset") as HTMLFieldSetElement).disabled).toBe(false));
  for (const [label, value] of [["Date", "2026-10-09T09:00"], ["Reference", "DEP-01"], ["Reason", "Reviewed depreciation"]]) fireEvent.change(screen.getByLabelText(label!), { target: { value } });
  fireEvent.change(screen.getAllByLabelText("Ledger account")[0]!, { target: { value: "expense" } }); fireEvent.change(screen.getAllByLabelText("Ledger account")[1]!, { target: { value: "asset" } });
  fireEvent.change(screen.getAllByLabelText("Debit (₦)")[0]!, { target: { value: "500.03" } }); fireEvent.change(screen.getAllByLabelText("Credit (₦)")[1]!, { target: { value: "500.03" } });
  toggle(); const button = screen.getByRole("button", { name: "Post balanced journal", hidden: true }); fireEvent.click(button);
  expect(api.mock.calls.filter(call => call[1].action === "post")).toHaveLength(0); expect(sessionStorage.getItem("abr-pending-journal:org:user")).toBeNull();
  review(button); fireEvent.click(button); await waitFor(() => expect(api.mock.calls.filter(call => call[1].action === "post")).toHaveLength(1));
  expect(api.mock.calls.find(call => call[1].action === "post")![1]).toMatchObject({ branchId: "store", lines: [{ accountId: "expense", debitMinor: 50003, creditMinor: 0 }, { accountId: "asset", debitMinor: 0, creditMinor: 50003 }] });
});

it("replays the saved journal key and original store without exposing amounts", async () => {
  const saved = { action: "post", branchId: "original-store", effectiveAt: "2026-10-09T09:00:00.000Z", reference: "DEP-01", reason: "Reviewed depreciation", idempotencyKey: "saved-journal-key", lines: [{ accountId: "expense", debitMinor: 50003, creditMinor: 0 }, { accountId: "asset", debitMinor: 0, creditMinor: 50003 }] };
  sessionStorage.setItem("abr-pending-journal:org:user", JSON.stringify(saved)); api.mockImplementation(async (_name, input) => input.action === "workspace" ? journalWorkspace : { journalNumber: "JRN-1" });
  render(<Workspace><JournalWorkspace {...journalProps} branchId="other-store" /></Workspace>); await ready();
  fireEvent.click(await screen.findByRole("button", { name: "Retry saved accounting instructions" })); await waitFor(() => expect(api).toHaveBeenCalledWith("accountingJournals", saved));
});

const providerRow = { saleId: "sale-1", saleNumber: "INV-1", branchId: "store", componentId: "component-1", supplierId: "supplier-1", supplierName: "Installer", originalMinor: 200000, creditedMinor: 0, collectedMinor: 200000, settledMinor: 0, outstandingMinor: 200000, invoiceDate: "2026-10-09" };
it("blocks a hidden provider payment draft, then submits the same reviewed amount and method", async () => {
  showInitially(); api.mockImplementation(async (_name, input) => input.action === "workspace" ? { rows: [providerRow], nextCursorId: null, summary: null } : input.action === "detail" ? { rows: [providerRow], payments: [] } : {});
  render(<Workspace><ProviderFunds ownerKey="org:user" branchId="store" accounts={banks} canPay canRecover /></Workspace>); await ready();
  fireEvent.click(await screen.findByRole("button", { name: "History / payment" }));
  fireEvent.change(await screen.findByLabelText("Amount (₦)"), { target: { value: "123.45" } });
  fireEvent.change(screen.getByLabelText("Actual payment / recovery reference"), { target: { value: "PAY-001" } }); fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Actual provider settlement" } });
  toggle(); const button = screen.getByRole("button", { name: "Record provider payment" }); fireEvent.click(button);
  expect(api.mock.calls.filter(call => call[1].action === "settle")).toHaveLength(0); expect(sessionStorage.getItem("warehouse-billing-operation:org:user:provider:store")).toBeNull();
  review(button); fireEvent.click(button); await waitFor(() => expect(api.mock.calls.filter(call => call[1].action === "settle")).toHaveLength(1));
  expect(api.mock.calls.find(call => call[1].action === "settle")![1]).toMatchObject({ saleId: "sale-1", componentId: "component-1", amountMinor: 12345, method: "cash", reference: "PAY-001", idempotencyKey: expect.any(String) });
});

it("retries the saved provider instructions without creating a new key or requiring a draft", async () => {
  const saved = { name: "providerFunds", input: { action: "settle", saleId: "sale-1", componentId: "component-1", amountMinor: 12345, method: "bank_transfer", bankAccountId: "a", reference: "PAY-001", reason: "Actual provider settlement", idempotencyKey: "saved-provider-key" } };
  sessionStorage.setItem("warehouse-billing-operation:org:user:provider:store", JSON.stringify(saved)); api.mockImplementation(async (_name, input) => input.action === "workspace" ? { rows: [], nextCursorId: null, summary: null } : {});
  render(<Workspace><ProviderFunds ownerKey="org:user" branchId="store" accounts={banks} canPay canRecover /></Workspace>); await ready();
  fireEvent.click(await screen.findByRole("button", { name: "Retry saved provider transaction" })); await waitFor(() => expect(api).toHaveBeenCalledWith(saved.name, saved.input));
});

it("keeps scope reviews local, closes them on global hide/cross-tab updates and prevents native-submit bypasses", async () => {
  const submitted = vi.fn();
  function Form() { const [amount, setAmount] = useState("12.34"); return <FinancialActionScope><form aria-label="Scoped payment" onSubmit={event => { event.preventDefault(); submitted(amount); }}><FinancialValue>₦12.34</FinancialValue><FinancialInput><input aria-label="Amount" value={amount} onChange={e => setAmount(e.target.value)} /></FinancialInput><FinancialAction><button type="submit">Record payment</button></FinancialAction></form></FinancialActionScope>; }
  render(<Workspace><Form /><FinancialValue>₦98.76 outside</FinancialValue></Workspace>); await ready();
  const form = screen.getByRole("form", { name: "Scoped payment" }), button = screen.getByRole("button", { name: "Record payment" });
  fireEvent.submit(form); expect(submitted).not.toHaveBeenCalled(); review(button); expect(screen.queryByText("₦98.76 outside")).toBeNull(); fireEvent.submit(form); expect(submitted).toHaveBeenCalledWith("12.34");
  toggle(); toggle(); fireEvent.click(button); expect(submitted).toHaveBeenCalledTimes(1);
  review(button); act(() => window.dispatchEvent(new StorageEvent("storage", { key }))); await waitFor(() => expect(screen.queryByLabelText("Amount")).toBeNull()); fireEvent.submit(form); expect(submitted).toHaveBeenCalledTimes(1);
});

it("fails closed outside an action scope and permits nonfinancial branches without revealing money", async () => {
  const financial = vi.fn(), metadata = vi.fn(); render(<Workspace><FinancialAction><button onClick={financial}>Post</button></FinancialAction><FinancialAction financial={false}><button onClick={metadata}>Save metadata</button></FinancialAction></Workspace>); await ready();
  fireEvent.click(screen.getByRole("button", { name: "Post" })); expect(financial).not.toHaveBeenCalled(); expect(screen.getByText(/Nothing was submitted. Show financial values/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Save metadata" })); expect(metadata).toHaveBeenCalledOnce(); toggle(); fireEvent.click(screen.getByRole("button", { name: "Post" })); expect(financial).toHaveBeenCalledOnce();
});

it("guards retained bank balances and raw statement rows before direct reconciliation writes", async () => {
 showInitially(); const bankWorkspace = { accounts: banks, branches: [], statementTransactions: [], journalLines: [], reconciliations: [] };
 api.mockImplementation(async name => name === "getBankReconciliationWorkspace" ? bankWorkspace : {});
 render(<Workspace><BankingPage /></Workspace>); await ready();
 const prepareRegion = (await screen.findByText("4. Prepare period reconciliation")).closest("details")!;
 fireEvent.change(within(prepareRegion).getByLabelText("Opening balance (₦)"), {target:{value:"-12.34"}}); fireEvent.change(within(prepareRegion).getByLabelText("Closing balance (₦)"), {target:{value:"87.67"}});
 const importRegion = screen.getByText("2. Import statement transactions").closest("details")!;
 const csv = "2026-10-09,Customer transfer,100.01,TRF-001"; fireEvent.change(within(importRegion).getByRole("textbox"), {target:{value:csv}});
 toggle(); expect(importRegion.querySelector("textarea")).toBeNull();
 const prepare = within(prepareRegion).getByRole("button", {name:"Prepare reconciliation",hidden:true}), importButton = within(importRegion).getByRole("button", {name:"Import statement",hidden:true});
 fireEvent.click(prepare); fireEvent.click(importButton); expect(api.mock.calls.filter(c=>c[0]!=="getBankReconciliationWorkspace")).toHaveLength(0);
 review(prepare); fireEvent.click(prepare); await waitFor(()=>expect(api).toHaveBeenCalledWith("prepareBankReconciliation",expect.objectContaining({openingBalanceMinor:-1234,closingBalanceMinor:8767})));
 await waitFor(()=>expect((importButton as HTMLButtonElement).disabled).toBe(false)); review(importButton); expect(importRegion.querySelector("textarea")!.value).toBe(csv); fireEvent.click(importButton);
 await waitFor(()=>expect(api).toHaveBeenCalledWith("importBankStatement",expect.objectContaining({rows:[expect.objectContaining({amountMinor:10001,reference:"TRF-001"})]})));
});
it("requires review of a bank account's default opening balance before creation", async () => {
 api.mockImplementation(async name => name === "getBankReconciliationWorkspace" ? {accounts:banks,branches:[],statementTransactions:[],journalLines:[],reconciliations:[]} : {bankAccountId:"a"});
 render(<Workspace><BankingPage /></Workspace>); await ready();
 const region = (await screen.findByText("1. Add a bank account")).closest("details")!;
 fireEvent.change(within(region).getByLabelText("Bank name"),{target:{value:"Actual bank"}}); fireEvent.change(within(region).getByLabelText("Account number — last 4 digits"),{target:{value:"4321"}});
 const button = within(region).getByRole("button",{name:"Add bank account",hidden:true}); await waitFor(()=>expect((button as HTMLButtonElement).disabled).toBe(false));
 fireEvent.click(button); expect(api.mock.calls.filter(c=>c[0]==="saveBankAccount")).toHaveLength(0); review(button); fireEvent.click(button);
 await waitFor(()=>expect(api).toHaveBeenCalledWith("saveBankAccount",expect.objectContaining({openingBalanceMinor:0,bankName:"Actual bank",accountNumberLast4:"4321"})));
});
it("allows a native retry submitter to replay only its existing saved instruction", async () => {
 const submitted = vi.fn(); render(<Workspace><FinancialActionScope><form aria-label="Saved instructions" onSubmit={e=>{e.preventDefault();submitted("saved-key");}}><FinancialInput><input aria-label="Locked amount" value="12.34" disabled readOnly /></FinancialInput><FinancialAction retry><button type="submit">Retry saved</button></FinancialAction></form></FinancialActionScope></Workspace>); await ready();
 fireEvent.click(screen.getByRole("button",{name:"Retry saved"})); expect(submitted).toHaveBeenCalledExactlyOnceWith("saved-key");
});

it("requires full action review if a financial selection remains masked after reviewing its input", async () => {
 const posted = vi.fn(); render(<Workspace><FinancialActionScope><section><FinancialInput><input aria-label="Amount" defaultValue="1.23" /></FinancialInput><select aria-label="Financial selection"><option><FinancialValue textOnly>₦45.67</FinancialValue></option></select><FinancialAction><button onClick={posted}>Record selected</button></FinancialAction></section></FinancialActionScope></Workspace>); await ready();
 fireEvent.click(screen.getByRole("button",{name:"Review / enter actual amount: Amount"})); const button=screen.getByRole("button",{name:"Record selected"}); fireEvent.click(button); expect(posted).not.toHaveBeenCalled(); review(button); fireEvent.click(button); expect(posted).toHaveBeenCalledOnce();
});

it("checks ref-backed retry instructions at click time and never treats an empty ref as a retry", async () => {
 const submitted = vi.fn();
 function Direct() { const saved=useRef<string|null>(null); return <><button onClick={()=>{saved.current="original-key";}}>Restore immutable instructions</button><FinancialAction retry={()=>Boolean(saved.current)}><button onClick={()=>submitted(saved.current)}>Retry direct</button></FinancialAction></>; }
 render(<Workspace><Direct /></Workspace>); await ready(); fireEvent.click(screen.getByRole("button",{name:"Retry direct"})); expect(submitted).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button",{name:"Restore immutable instructions"})); fireEvent.click(screen.getByRole("button",{name:"Retry direct"})); expect(submitted).toHaveBeenCalledExactlyOnceWith("original-key");
});

// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { useForm } from "react-hook-form";
import { useState, type ReactNode } from "react";
import { FinancialAttributes, FinancialDetails, FinancialField, FinancialInput, FinancialPrivacyProvider, FinancialText, FinancialValue, isFinancialField, privacyStorageKey, storedFinancialPrivacy } from "@/features/finance/financial-privacy";
import { FinancialPrivacyToggle } from "@/features/finance/financial-privacy-toggle";
import { FinancialAmount } from "@/components/ui/financial-amount";
import { MoneyTenderEditor, parseMoneyTenders, type MoneyTenderDraft } from "@/features/finance/money-tender-editor";
import { SupplierAccounts } from "@/features/procurement/supplier-accounts";
import { JournalWorkspace } from "@/features/accounting/journal-workspace";
import { AccountReceiptDialog } from "@/features/finance/account-receipt";
import { CeoActivity } from "@/features/dashboard/ceo-activity";
import { OperationalMixChart, SalesPaymentMixChart, SalesTrendChart, TransferPipelineChart } from "@/features/dashboard/charts";
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => ({ profile: null }) }));
const api = vi.hoisted(() => vi.fn());
vi.mock("@/features/administration/api", () => ({ callAdministration: api }));
const key = privacyStorageKey("org", "user");
function Workspace({ children, org = "org", uid = "user" }: { children: ReactNode; org?: string; uid?: string }) { return <FinancialPrivacyProvider organizationId={org} uid={uid}><FinancialPrivacyToggle />{children}</FinancialPrivacyProvider>; }
async function ready() { await waitFor(() => expect(screen.getByRole("button", { name: "Hide financial values" }).hasAttribute("disabled")).toBe(false)); }
function toggle() { fireEvent.click(screen.getByRole("button", { name: "Hide financial values" })); }
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); api.mockReset(); sessionStorage.clear(); vi.restoreAllMocks(); });

it("renders hidden before browser preferences load, even when this identity previously chose visible", async () => {
  localStorage.setItem(key, JSON.stringify({ version: 1, hidden: false }));
  const markup = renderToString(<Workspace><FinancialValue>₦87,654.32</FinancialValue></Workspace>);
  expect(markup).not.toContain("87,654.32");
  expect(markup).toContain("Financial value hidden");
  render(<Workspace><FinancialValue>₦87,654.32</FinancialValue></Workspace>);
  await ready(); expect(screen.getByText("₦87,654.32")).toBeTruthy();
});
it("stores only a boolean versioned preference scoped to org and user, with no stale identity exposure", async () => {
  const view = render(<Workspace><FinancialValue>₦87,654.32</FinancialValue></Workspace>); await ready();
  toggle(); expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ version: 1, hidden: false });
  expect(localStorage.getItem(key)).not.toContain("87,654");
  view.rerender(<Workspace uid="other"><FinancialValue>₦87,654.32</FinancialValue></Workspace>);
  expect(view.container.textContent).not.toContain("87,654.32"); await ready();
  view.rerender(<Workspace org="other" uid="user"><FinancialValue>₦87,654.32</FinancialValue></Workspace>);
  expect(view.container.textContent).not.toContain("87,654.32"); await ready();
  view.rerender(<Workspace><FinancialValue>₦87,654.32</FinancialValue></Workspace>); await ready();
  expect(view.container.textContent).toContain("87,654.32");
});
it("defaults hidden for absent, malformed or incompatible preferences and anonymous identities", () => {
  for (const stored of [null, "bad", "true", "{}", '{"version":2,"hidden":false}', '{"version":1,"hidden":"false"}']) expect(storedFinancialPrivacy(stored)).toBe(true);
  expect(storedFinancialPrivacy('{"version":1,"hidden":false}')).toBe(false);
  expect(privacyStorageKey("a:b", "c")).not.toBe(privacyStorageKey("a", "b:c"));
  render(<FinancialPrivacyProvider><FinancialPrivacyToggle /><FinancialValue>₦87,654.32</FinancialValue></FinancialPrivacyProvider>);
  expect(screen.queryByText("₦87,654.32")).toBeNull(); expect(screen.getByRole("button", { name: "Hide financial values" }).hasAttribute("disabled")).toBe(true);
});
it("supports an in-memory choice if storage fails and accepts only this identity's cross-tab updates", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
  render(<Workspace><FinancialValue>₦87,654.32</FinancialValue></Workspace>); await ready(); toggle();
  expect(screen.getByText("₦87,654.32")).toBeTruthy();
  expect(screen.getByText(/Device storage is unavailable/)).toBeTruthy();
});
it("reacts to matching cross-tab preferences and closes local reviews when restored hidden", async () => {
  render(<Workspace><FinancialDetails>₦87,654.32 detail</FinancialDetails></Workspace>); await ready();
  fireEvent.click(screen.getByRole("button", { name: "Review actual technical details" }));
  expect(screen.getByText("₦87,654.32 detail")).toBeTruthy();
  localStorage.setItem(key, '{"version":1,"hidden":false}');
  act(() => window.dispatchEvent(new StorageEvent("storage", { key: "another-user" })));
  expect(screen.getByRole("button", { name: "Hide financial values" }).getAttribute("aria-pressed")).toBe("true");
  act(() => window.dispatchEvent(new StorageEvent("storage", { key })));
  expect(screen.getByRole("button", { name: "Hide financial values" }).getAttribute("aria-pressed")).toBe("false");
  localStorage.setItem(key, '{"version":1,"hidden":true}');
  act(() => window.dispatchEvent(new StorageEvent("storage", { key })));
  expect(screen.queryByText("₦87,654.32 detail")).toBeNull();
});
it("removes amounts and their accessibility attributes while preserving quantities, safe statuses and operational text", async () => {
  const view = render(<Workspace><FinancialAmount tone="outflow">₦87,654.32</FinancialAmount><FinancialAttributes financial><p title="87654.32" aria-label="87654.32">Balance</p></FinancialAttributes><FinancialValue>Not established</FinancialValue><FinancialField name="quantity">39</FinancialField><FinancialField name="amountMinor">8765432</FinancialField><FinancialText>Invoice INV-8765432, 12 items</FinancialText><FinancialText>Special fee ₦87,654.32</FinancialText></Workspace>); await ready();
  expect(view.container.innerHTML).not.toContain("87,654.32");
  expect(view.container.querySelector('[title="87654.32"]')).toBeNull();
  expect(view.container.textContent).toContain("39"); expect(view.container.textContent).toContain("Not established");
  expect(view.container.textContent).toContain("Invoice INV-8765432, 12 items");
  expect(view.container.querySelector(".finance-outflow")).toBeNull();
  toggle(); expect(screen.getByText("₦87,654.32")).toBeTruthy();
  expect(view.container.querySelector('[title="87654.32"]')).toBeTruthy();
});
it("classifies generic report money columns without masking physical balances, counts or references", () => {
  for (const field of ["amountMinor", "unitCostMinor", "inventoryValue", "grossProfitMinor", "marginPercent", "variancePercent", "rateBasisPoints", "debit", "outstandingBalance"]) expect(isFinancialField(field), field).toBe(true);
  for (const field of ["quantity", "paymentCount", "invoiceNumber", "paymentMethod", "balanceBefore", "balanceAfter", "quantityDelta", "reservedQuantityDelta", "onHand", "priceTier", "amountCurrency", "creditDays"]) expect(isFinancialField(field), field).toBe(false);
});
it("retains exact controlled tender values across local hide/show and blocks a hidden form submission", async () => {
  const submitted = vi.fn();
  function TenderForm() {
    const [value, setValue] = useState<MoneyTenderDraft[]>([{ id: "cash", method: "cash", amount: "33.33", bankAccountId: "", reference: "" }, { id: "bank", method: "bank_transfer", amount: "66.68", bankAccountId: "bank", reference: "BANK-1" }]);
    return <form aria-label="Payment" onSubmit={event => { event.preventDefault(); submitted(parseMoneyTenders(value, 10001)); }}><MoneyTenderEditor value={value} onChange={setValue} total={10001} banks={[{ id: "bank", bankName: "Bank", accountName: "Operating", accountNumberLast4: "1234" }]} /><label>Quantity<input aria-label="Quantity" type="number" defaultValue="7" /></label><button type="submit">Record</button></form>;
  }
  render(<Workspace><TenderForm /></Workspace>); await ready();
  expect(screen.queryByLabelText("Part 1 amount")).toBeNull();
  expect((screen.getByLabelText("Quantity") as HTMLInputElement).value).toBe("7");
  fireEvent.submit(screen.getByRole("form", { name: "Payment" })); expect(submitted).not.toHaveBeenCalled();
  fireEvent.click(screen.getAllByRole("button", { name: /^Review \/ enter actual amount/ })[0]!);
  fireEvent.change(screen.getByLabelText("Part 1 amount"), { target: { value: "33.32" } });
  fireEvent.click(screen.getByRole("button", { name: /^Hide input/ }));
  fireEvent.click(screen.getAllByRole("button", { name: /^Review \/ enter actual amount/ })[0]!);
  expect((screen.getByLabelText("Part 1 amount") as HTMLInputElement).value).toBe("33.32");
  fireEvent.change(screen.getByLabelText("Part 1 amount"), { target: { value: "33.33" } });
  fireEvent.click(screen.getByRole("button", { name: /^Review \/ enter actual amount/ }));
  fireEvent.submit(screen.getByRole("form", { name: "Payment" }));
  expect(document.querySelector(".financial-form-notice")).toBeNull();
  expect(submitted).toHaveBeenCalledExactlyOnceWith({ error: null, parts: [{ method: "cash", amountMinor: 3333 }, { method: "bank_transfer", amountMinor: 6668, bankAccountId: "bank", reference: "BANK-1" }] });
  expect(JSON.parse(localStorage.getItem(key) ?? '{"hidden":true}').hidden).toBe(true);
  toggle(); toggle(); expect(screen.queryByLabelText("Part 1 amount")).toBeNull();
});
it("keeps disabled amount controls from blocking forms and closes only the local explicit review", async () => {
  const submit = vi.fn();
  render(<Workspace><form aria-label="Disabled" onSubmit={event => { event.preventDefault(); submit(); }}><FinancialInput><input type="number" value="87654.32" disabled readOnly /></FinancialInput><button type="submit">Submit</button></form><FinancialDetails>Private ₦87,654.32</FinancialDetails></Workspace>); await ready();
  fireEvent.submit(screen.getByRole("form", { name: "Disabled" })); expect(submit).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Review actual technical details" }));
  fireEvent.click(screen.getByRole("button", { name: "Hide this review" }));
  expect(screen.queryByText("Private ₦87,654.32")).toBeNull();
});
it("removes money geometry, percentages, tooltips and axes while retaining count chart geometry", async () => {
  const data = [{ label: "Open", value: 17, color: "#34458f" }, { label: "Waiting", value: 4, color: "#6074bd" }];
  const view = render(<Workspace><SalesTrendChart data={[{ date: "2026-10-18", label: "18 Oct", value: 8765432, count: 39 }]} /><CeoActivity workspace={null} invoiced={8765432} loading={false} href={path => path} onNavigate={() => {}} /><OperationalMixChart data={data} /><TransferPipelineChart data={data} /><SalesPaymentMixChart data={data} /></Workspace>); await ready();
  const moneyChart = screen.getByRole("figure", { name: "Sales trend with financial values hidden" });
  expect(moneyChart.textContent).toContain("39 sales"); expect(moneyChart.querySelector("[style], [title], [role=img]")).toBeNull();
  expect(screen.getByRole("region", { name: "Financial charts hidden" }).querySelector("[style], [title], .ceo-axis, .ceo-bars")).toBeNull();
  expect(view.container.innerHTML).not.toContain("8765432"); expect(view.container.querySelectorAll('[role="img"]')).toHaveLength(3);
  expect(view.container.querySelector('[style*="conic-gradient"]')).toBeTruthy();
  toggle(); expect(screen.queryByRole("figure", { name: "Sales trend with financial values hidden" })).toBeNull();
  expect(screen.getByRole("img", { name: /2026-10-18:/ })).toBeTruthy();
});
it("prints the actual receipt in a local scope then returns to masked display without changing the preference", async () => {
  const receipt: Parameters<typeof AccountReceiptDialog>[0]["receipt"] = { id: "payment", party: "customer", companyName: "Company", partyName: "Amina", partyNumber: "CUS-1", paymentNumber: "CRP-1", purpose: "repayment", direction: "inflow", source: "receipt", amountMinor: 8765432, at: "2026-10-18T12:00:00Z", reference: "REF-1", notes: null, journalEntryId: "journal", balanceScope: "At payment", outstandingAfterMinor: null, advanceAfterMinor: 10001, tenders: [{ method: "cash", amountMinor: 8765432, bankName: null, accountName: null, accountNumberLast4: null, reference: null }], allocations: [], arrangements: [] };
  const snapshots: string[] = [];
  vi.spyOn(window, "print").mockImplementation(() => { snapshots.push(screen.getByRole("dialog").textContent ?? ""); });
  render(<Workspace><p>Outside <FinancialValue>₦99,999.99</FinancialValue></p><AccountReceiptDialog receipt={receipt} onClose={() => {}} /></Workspace>); await ready();
  const dialog = screen.getByRole("dialog"); expect(dialog.textContent).not.toContain("87,654.32");
  fireEvent.click(within(dialog).getByRole("button", { name: "Print receipt / save PDF" }));
  await waitFor(() => expect(snapshots).toHaveLength(1)); expect(snapshots[0]).toContain("87,654.32"); expect(snapshots[0]).toContain("100.01");
  expect(screen.queryByText("₦99,999.99")).toBeNull();
  act(() => window.dispatchEvent(new Event("afterprint"))); expect(dialog.textContent).not.toContain("87,654.32");
  expect(localStorage.getItem(key)).toBeNull(); expect(screen.getByRole("button", { name: "Hide financial values" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(within(dialog).getByRole("button", { name: "Review actual document values" })); expect(dialog.textContent).toContain("87,654.32");
  toggle(); toggle(); expect(dialog.textContent).not.toContain("87,654.32");
});

it("hides draft journal totals and retains operational labels and exact reviewed input values", async () => {
  api.mockResolvedValue({ entries: [], nextCursorId: null, bankAccounts: [], accounts: [] });
  render(<Workspace><JournalWorkspace ownerKey="privacy-journal" branchId="store" canCreate canReverse={false} canManageAccounts={false} /></Workspace>); await ready();
  const details = screen.getByText("Post an accountant adjustment").closest("details")!;
  details.open = true; fireEvent(details, new Event("toggle"));
  await waitFor(() => expect((screen.getByLabelText("Date").closest("fieldset") as HTMLFieldSetElement).disabled).toBe(false));
  toggle();
  fireEvent.change(screen.getAllByLabelText("Debit (₦)")[0]!, { target: { value: "87654.32" } });
  fireEvent.change(screen.getAllByLabelText("Credit (₦)")[1]!, { target: { value: "87654.32" } });
  expect(details.textContent).toContain("87,654.32"); toggle();
  expect(details.textContent).not.toContain("87,654.32");
  expect(screen.queryAllByRole("spinbutton", { name: "Debit (₦)" })).toHaveLength(0);
  expect(screen.getByText("Add line")).toBeTruthy();
  toggle(); expect((screen.getAllByLabelText("Debit (₦)")[0] as HTMLInputElement).value).toBe("87654.32");
  expect(api.mock.calls.every(call => call[1].action === "workspace")).toBe(true);
});

it("retains registered form amounts while unmounted and submits the original numeric values after review", async () => {
  const submitted = vi.fn();
  function RegisteredForm() {
    const form = useForm<{ cost: number; quantity: number }>({ defaultValues: { cost: 33.33, quantity: 7 } });
    return <form aria-label="Registered inventory" onSubmit={form.handleSubmit(submitted)}><label>Unit cost<FinancialInput><input aria-label="Registered unit cost" type="number" step="0.01" {...form.register("cost", { valueAsNumber: true })} /></FinancialInput></label><label>Units<input aria-label="Units" type="number" {...form.register("quantity", { valueAsNumber: true })} /></label><button type="submit">Submit registered</button></form>;
  }
  render(<Workspace><RegisteredForm /></Workspace>); await ready();
  fireEvent.click(screen.getByRole("button", { name: "Review / enter actual amount: Registered unit cost" }));
  expect((screen.getByLabelText("Registered unit cost") as HTMLInputElement).value).toBe("33.33");
  fireEvent.change(screen.getByLabelText("Registered unit cost"), { target: { value: "66.68" } });
  fireEvent.click(screen.getByRole("button", { name: "Hide input: Registered unit cost" }));
  fireEvent.submit(screen.getByRole("form", { name: "Registered inventory" })); expect(submitted).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Review / enter actual amount: Registered unit cost" }));
  expect((screen.getByLabelText("Registered unit cost") as HTMLInputElement).value).toBe("66.68");
  fireEvent.submit(screen.getByRole("form", { name: "Registered inventory" }));
  await waitFor(() => expect(submitted).toHaveBeenCalledOnce()); expect(submitted.mock.calls[0]![0]).toEqual({ cost: 66.68, quantity: 7 });
});

it("prints supplier statement actual balances only after explicit output intent and retains masked on-screen history", async () => {
  const statement = { complete: true, statementVersion: "v1", supplier: { name: "Synthetic supplier", supplierNumber: "SUP-DEMO" }, entries: [{ id: "invoice", entryType: "supplier_invoice", referenceNumber: "SUP-INV-DEMO", amountMinor: 8765432, advanceAmountMinor: 0, effectiveAt: { seconds: 1792324800 }, runningPayableMinor: 8765432, runningAdvanceMinor: 10001 }], nextCursor: null, scopeNote: "Synthetic store", openingPayableMinor: 0, closingPayableMinor: 8765432, openingAdvanceMinor: 10001, closingAdvanceMinor: 10001 };
  api.mockImplementation((_name, input) => Promise.resolve(input.view === "supplier_payables" ? { asOfDate: "2026-10-18", totalOutstandingMinor: 8765432, unusedCreditMinor: 10001, aging: [], invoices: [], nextCursor: null, note: "Synthetic" } : statement));
  const snapshots: string[] = [];
  vi.spyOn(window, "print").mockImplementation(() => { snapshots.push(document.querySelector("[data-print-document]")?.textContent ?? ""); });
  render(<Workspace><SupplierAccounts suppliers={[{ id: "supplier", organizationId: "org", supplierNumber: "SUP-DEMO", name: "Synthetic supplier", active: true, paymentTermsDays: 0, outstandingBalanceMinor: 8765432 }]} initialSupplierId="supplier" scope={{ branchId: "store" }} banks={[]} branches={[{ id: "store", name: "Demo" }]} canPay={false} invoice={null} closeInvoice={() => {}} onComplete={() => {}} /></Workspace>); await ready();
  const output = await screen.findByRole("button", { name: "Print full statement / save PDF" });
  const region = screen.getByRole("region", { name: "Supplier account statement" }); expect(region.textContent).not.toContain("87,654.32");
  fireEvent.click(output); await waitFor(() => expect(snapshots).toHaveLength(1));
  expect(snapshots[0]).toContain("87,654.32"); expect(snapshots[0]).toContain("100.01");
  expect(region.textContent).not.toContain("87,654.32");
  act(() => window.dispatchEvent(new Event("afterprint"))); expect(document.querySelector("[data-print-document]")).toBeNull();
  expect(api.mock.calls.every(call => call[0] === "getProcurementWorkspace")).toBe(true);
});

it("respects disabled-fieldset submission semantics without exposing the stored amount", async () => {
  const submit = vi.fn();
  function Form() { const [disabled, setDisabled] = useState(true); return <><button type="button" onClick={() => setDisabled(false)}>Enable amounts</button><form aria-label="Disabled amount group" onSubmit={event => { event.preventDefault(); submit(); }}><fieldset disabled={disabled}><FinancialInput><input aria-label="Grouped amount" type="number" value="87654.32" readOnly /></FinancialInput></fieldset><button type="submit">Submit group</button></form></>; }
  render(<Workspace><Form /></Workspace>); await ready();
  fireEvent.submit(screen.getByRole("form", { name: "Disabled amount group" })); expect(submit).toHaveBeenCalledOnce();
  expect(screen.queryByLabelText("Grouped amount")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Enable amounts" }));
  fireEvent.submit(screen.getByRole("form", { name: "Disabled amount group" })); expect(submit).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Review / enter actual amount: Grouped amount" }));
  fireEvent.submit(screen.getByRole("form", { name: "Disabled amount group" })); expect(submit).toHaveBeenCalledTimes(2);
});

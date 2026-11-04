// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HQTransferPricing, InternalTradeInvoiceCard } from "@/features/branch-trading/transfer-trading";
import { BranchTradingWorkspace } from "@/features/branch-trading/branch-trading-workspace";
import { InvoiceTradingActions } from "@/features/branch-trading/invoice-trading-actions";
import { FinancialPrivacyProvider, privacyStorageKey } from "@/features/finance/financial-privacy";
import type { StockTransfer } from "../functions/src/transfers/simple-model";
import type { InternalTradeInvoice, InternalTradeWorkspace } from "../functions/src/branch-trading/model";
const mocks = vi.hoisted(() => ({ api: vi.fn(), auth: { profile: {organizationId: "org", uid: "user", status: "active", roleId: "system_administrator"}, operatingContext: null as {type: string; id: string} | null } }));
vi.mock("@/features/administration/api", () => ({callAdministration: mocks.api}));
vi.mock("@/features/auth/auth-context", () => ({useAuth: () => mocks.auth}));
const invoice: InternalTradeInvoice = {id: "inv-1", transferId: "t-1", number: "IT-1", organizationId: "org", branchId: "branch", branchName: "Branch One", headOfficeBranchId: "hq", sourceLocationId: "hq-store", destinationLocationId: "branch-store", totalMinor: 100000, paidMinor: 20000, returnedMinor: 0, balanceMinor: 80000, version: 1, currency: "NGN", createdAt: "2026-10-01T10:00:00Z", updatedAt: "2026-10-01T10:00:00Z", lines: [{id: "line", productId: "product", productName: "Fan", sku: "F1", trackingType: "bulk", unitPriceMinor: 50000, receivedQuantity: 2, returnedQuantity: 0, serialItemIds: [], returnedSerialItemIds: []}]};
const workspace: InternalTradeWorkspace = {entries: [], nextEntriesCursor: null, invoices: [invoice], balances: [{organizationId: "org", branchId: "branch", headOfficeBranchId: "hq", invoicedMinor: 9990000, paidMinor: 20000, returnedMinor: 0, balanceMinor: 9970000, version: 1}], branches: [{id: "branch", name: "Branch One"}], accounts: [{id: "source", name: "Branch Bank", branchId: "branch"}, {id: "dest", name: "HQ Bank", branchId: "hq"}], nextCursor: null, canReadTrading: true, canPrice: true, canReviewDamage: true, canRecordPayment: true, canReturn: true};
const transfer = {id: "t-1", version: 1, status: "requested", tradeAgreement: {version: 1, headOfficeBranchId: "hq", pricingStatus: "required", pricesByLineId: {}}, items: [{id: "line", productName: "Fan", sku: "F1"}]} as StockTransfer;
afterEach(() => {cleanup(); vi.resetAllMocks(); sessionStorage.clear(); localStorage.clear(); mocks.auth.operatingContext = null;});
beforeEach(() => {Object.defineProperty(navigator, "onLine", {value: true, configurable: true});});
describe("internal branch trading UI", () => {
  it("does not add pricing to legacy transfers or allow edits after confirmation", () => {
    const onPrice = vi.fn();
    const view = render(<HQTransferPricing transfer={{...transfer, tradeAgreement: undefined}} canPrice disabled={false} onPrice={onPrice} />);
    expect(screen.queryByText("Head-office internal prices")).toBeNull();
    view.rerender(<HQTransferPricing transfer={{...transfer, status: "awaiting_receipt"}} canPrice disabled={false} onPrice={onPrice} />);
    expect(screen.queryByRole("button", {name: "Save internal prices"})).toBeNull();
  });
  it("requires exact positive prices and sends minor units", async () => {
    const onPrice = vi.fn().mockResolvedValue(undefined);
    render(<HQTransferPricing transfer={transfer} canPrice disabled={false} onPrice={onPrice} />);
    fireEvent.change(screen.getByLabelText("Internal unit price for Fan (₦)"), {target: {value: "12.345"}});
    fireEvent.click(screen.getByRole("button", {name: "Save internal prices"}));
    expect(onPrice).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Internal unit price for Fan (₦)"), {target: {value: "12.35"}});
    fireEvent.click(screen.getByRole("button", {name: "Save internal prices"}));
    await waitFor(() => expect(onPrice).toHaveBeenCalledWith([{id: "line", unitPriceMinor: 1235}]));
  });
  it("labels overpaid returned invoices as branch credit, not negative outstanding", () => {
    render(<InternalTradeInvoiceCard invoice={{...invoice, balanceMinor: -20000}} />);
    expect(screen.getByText("Branch credit")).toBeTruthy();
    expect(screen.queryByText("Outstanding")).toBeNull();
    expect(screen.getByRole("link").getAttribute("href")).toBe("/transfers/accounts?invoice=inv-1");
  });
  it("masks invoice amounts when financial privacy is hidden", async () => {
    localStorage.setItem(privacyStorageKey("org", "user"), JSON.stringify({version: 1, hidden: true}));
    render(<FinancialPrivacyProvider organizationId="org" uid="user"><InternalTradeInvoiceCard invoice={invoice} /></FinancialPrivacyProvider>);
    await waitFor(() => expect(screen.getAllByLabelText("Financial value hidden")).toHaveLength(4));
    expect(screen.queryByText(/1,000\.00/)).toBeNull();
  });
  it("uses persisted full balances and exact invoice lookup, not page sums", async () => {
    mocks.api.mockResolvedValue(workspace);
    render(<BranchTradingWorkspace invoiceId="inv-1" />);
    expect(await screen.findByText(/99,700\.00/)).toBeTruthy();
    expect(mocks.api).toHaveBeenCalledWith("stockTransfers", {action: "trading_workspace", invoiceId: "inv-1"});
    expect(screen.getByText("Original stock transfer")).toBeTruthy();
  });
  it("discards a late old-branch response after switching operating location", async () => {
    let resolveOld!: (value: InternalTradeWorkspace) => void;
    mocks.api.mockImplementationOnce(() => new Promise(resolve => {resolveOld = resolve;})).mockResolvedValue({...workspace, invoices: [], balances: []});
    const view = render(<BranchTradingWorkspace />);
    await waitFor(() => expect(mocks.api).toHaveBeenCalledOnce());
    mocks.auth.operatingContext = {type: "branch", id: "other"};
    view.rerender(<BranchTradingWorkspace />);
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
    resolveOld(workspace);
    await screen.findByText("No internal invoices yet. Legacy transfers do not create internal charges.");
    expect(screen.queryByText("Internal invoice IT-1")).toBeNull();
  });
  it("hides payment and return controls without server capabilities", () => {
    render(<InvoiceTradingActions invoice={invoice} workspace={{...workspace, canRecordPayment: false, canReturn: false}} owner="org:user:inv-1" scope="organization" onComplete={vi.fn()} />);
    expect(screen.queryByText("Record completed internal payment")).toBeNull();
    expect(screen.queryByText("Record received return")).toBeNull();
  });
  it("locks an uncertain payment and retries the exact saved request after reload", async () => {
    mocks.api.mockRejectedValueOnce(new Error("Connection lost")).mockResolvedValueOnce({posted: true});
    const props = {invoice, workspace, owner: "org:user:inv-1", scope: "organization", onComplete: vi.fn().mockResolvedValue(undefined)};
    const view = render(<InvoiceTradingActions {...props} />);
    await waitFor(() => expect((screen.getByLabelText("Internal payment amount (₦)").closest("fieldset") as HTMLFieldSetElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText("Internal payment amount (₦)"), {target: {value: "200.50"}});
    fireEvent.change(screen.getByLabelText("Date money moved"), {target: {value: "2026-10-01T12:00"}});
    fireEvent.change(screen.getByLabelText("Payment reference"), {target: {value: "BANK-REF"}});
    fireEvent.change(screen.getByLabelText("Branch source bank account"), {target: {value: "source"}});
    fireEvent.change(screen.getByLabelText("Head-office destination bank account"), {target: {value: "dest"}});
    fireEvent.click(screen.getByLabelText(/I confirm this payment/));
    fireEvent.click(screen.getByRole("button", {name: "Record completed internal payment"}));
    await screen.findByRole("button", {name: "Retry saved action"});
    const saved = mocks.api.mock.calls[0]![1];
    expect(saved).toMatchObject({action: "record_payment", amountMinor: 20050, confirmedCompleted: true});
    expect((screen.getByLabelText("Internal payment amount (₦)").closest("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
    view.unmount(); render(<InvoiceTradingActions {...props} />);
    fireEvent.click(await screen.findByRole("button", {name: "Retry saved action"}));
    await screen.findByText("Internal account updated.");
    expect(mocks.api.mock.calls[1]![1]).toEqual(saved);
  });
  it("requires physically received confirmation and selects original serial IDs for returns", async () => {
    mocks.api.mockResolvedValue({posted: true});
    const serialInvoice = {...invoice, lines: [{...invoice.lines[0]!, trackingType: "serial", serialItemIds: ["serial-a", "serial-b"], serialNumbers: {"serial-a": "SN-100", "serial-b": "SN-200"}, returnedSerialItemIds: ["serial-b"], returnedQuantity: 1}]};
    render(<InvoiceTradingActions invoice={serialInvoice} workspace={workspace} owner="org:user:inv-1" scope="organization" onComplete={vi.fn()} />);
    await waitFor(() => expect((screen.getByLabelText("Return note").closest("fieldset") as HTMLFieldSetElement).disabled).toBe(false));
    expect(screen.queryByLabelText("Serial SN-200")).toBeNull();
    expect((screen.getByRole("button", {name: "Record received return"}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Serial SN-100"));
    expect(screen.getByText(/Proposed returned-goods credit/).textContent).toContain("500.00");
    fireEvent.change(screen.getByLabelText("Return note"), {target: {value: "Received at HQ"}});
    fireEvent.click(screen.getByLabelText(/I confirm these goods are physically back/));
    fireEvent.click(screen.getByRole("button", {name: "Record received return"}));
    await waitFor(() => expect(mocks.api).toHaveBeenCalledWith("stockTransfers", expect.objectContaining({action: "return_goods", confirmedReceived: true, confirmedResellable: true, lines: [{id: "line", quantity: 1, serialItemIds: ["serial-a"]}]})));
  });
  it("blocks a restored uncertain action in a different working location", async () => {
    sessionStorage.setItem("abr-pending-stock-transfer:org:user:inv-1", JSON.stringify({scope: "branch:original", input: {action: "record_payment", idempotencyKey: "11111111-1111-4111-8111-111111111111", invoiceId: "inv-1", amountMinor: 100}}));
    render(<InvoiceTradingActions invoice={invoice} workspace={workspace} owner="org:user:inv-1" scope="branch:other" onComplete={vi.fn()} />);
    const retry = await screen.findByRole("button", {name: "Retry saved action"});
    expect((retry as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(retry);
    expect(mocks.api).not.toHaveBeenCalled();
    expect(screen.getByText("Return to the original working location before retrying the saved action.")).toBeTruthy();
  });
  it("continues invoice pages without adding page totals to the full balance", async () => {
    mocks.api.mockResolvedValueOnce({...workspace, nextCursor: "cursor-1"}).mockResolvedValueOnce({...workspace, invoices: [{...invoice, id: "inv-2", number: "IT-2"}]});
    render(<BranchTradingWorkspace />);
    fireEvent.click(await screen.findByRole("button", {name: "Load more invoices"}));
    await screen.findByText("Internal invoice IT-2");
    expect(screen.getByText("Internal invoice IT-1")).toBeTruthy();
    expect(screen.getAllByText(/99,700\.00/)).toHaveLength(1);
    expect(mocks.api.mock.calls[1]![1]).toEqual({action: "trading_workspace", cursor: "cursor-1"});
  });

  it("continues immutable account entries independently of invoice pagination", async () => {
    const entry = {id: "entry-1", invoiceId: invoice.id, kind: "payment", amountMinor: 10000, signedAmountMinor: -10000, createdAt: "2026-10-01T10:00:00Z", actorUserId: "user", reference: "PAY-001"};
    mocks.api.mockResolvedValueOnce({...workspace, entries: [entry], nextEntriesCursor: "entry-1"}).mockResolvedValueOnce({...workspace, entries: [{...entry, id: "entry-2", reference: "PAY-002"}]});
    render(<BranchTradingWorkspace invoiceId="inv-1" />);
    fireEvent.click(await screen.findByRole("button", {name: "Load more account entries"}));
    await screen.findByText("PAY-002");
    expect(screen.getByText("PAY-001")).toBeTruthy();
    expect(mocks.api.mock.calls[1]![1]).toEqual({action: "trading_workspace", invoiceId: "inv-1", entriesCursor: "entry-1"});
  });

  it("isolates print output and reveals invoice values only for the requested print", async () => {
    mocks.api.mockResolvedValue(workspace);
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    render(<FinancialPrivacyProvider organizationId="org" uid="user"><BranchTradingWorkspace invoiceId="inv-1" /></FinancialPrivacyProvider>);
    const button = await screen.findByRole("button", {name: "Print internal invoice"});
    const document = button.closest("[data-print-document]")!;
    expect(document.querySelectorAll("[data-financial-value]").length).toBeGreaterThan(0);
    expect(screen.getByText("Original stock transfer").getAttribute("href")).toBe("/transfers/simple/t-1");
    fireEvent.click(button);
    await waitFor(() => expect(print).toHaveBeenCalledOnce());
    expect(document.querySelectorAll("[data-financial-value]")).toHaveLength(0);
    expect(screen.getAllByLabelText("Financial value hidden").length).toBeGreaterThan(0);
    fireEvent(window, new Event("afterprint"));
    await waitFor(() => expect(document.querySelectorAll("[data-financial-value]").length).toBeGreaterThan(0));
    print.mockRestore();
  });
  it("describes redacted priced transfers as restricted rather than missing prices", () => {
    render(<HQTransferPricing transfer={{...transfer, status: "awaiting_receipt", tradeAgreement: {...transfer.tradeAgreement!, pricingStatus: "priced"}}} canPrice={false} disabled={false} onPrice={vi.fn()} />);
    expect(screen.getByText("Restricted")).toBeTruthy();
    expect(screen.queryByText("Not recorded")).toBeNull();
  });

  it("holds damaged charges and requires an explicit reviewed charge decision", async () => {
    mocks.api.mockResolvedValue({posted: true});
    const damaged = {...invoice, lines: [{...invoice.lines[0]!, damagedQuantity: 2, pendingDamagedQuantity: 2, chargedDamagedQuantity: 0, waivedDamagedQuantity: 0}]};
    render(<InvoiceTradingActions invoice={damaged} workspace={workspace} owner="org:user:inv-1" scope="organization" onComplete={vi.fn()} />);
    await waitFor(() => expect((screen.getByLabelText("Damage review decision").closest("fieldset") as HTMLFieldSetElement).disabled).toBe(false));
    expect((screen.getByLabelText("Damage review decision") as HTMLSelectElement).value).toBe("");
    fireEvent.change(screen.getByLabelText("Damaged quantity to review for Fan"), {target: {value: "1"}});
    expect((screen.getByRole("button", {name: "Save damage review"}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Damage review decision"), {target: {value: "charge"}});
    expect(screen.getByText(/Proposed additional branch charge/).textContent).toContain("500.00");
    fireEvent.change(screen.getByLabelText("Damage review note"), {target: {value: "Reviewed receiving damage evidence"}});
    fireEvent.click(screen.getByRole("button", {name: "Save damage review"}));
    await waitFor(() => expect(mocks.api).toHaveBeenCalledWith("stockTransfers", expect.objectContaining({action: "review_damage", invoiceId: "inv-1", version: 1, decision: "charge", lines: [{id: "line", quantity: 1}]})));
  });
  it("shows an explicit no-charge decision as zero additional debt", async () => {
    mocks.api.mockResolvedValue({posted: true});
    const damaged = {...invoice, lines: [{...invoice.lines[0]!, pendingDamagedQuantity: 2}]};
    render(<InvoiceTradingActions invoice={damaged} workspace={workspace} owner="org:user:inv-1" scope="organization" onComplete={vi.fn()} />);
    await waitFor(() => expect((screen.getByLabelText("Damage review decision").closest("fieldset") as HTMLFieldSetElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText("Damaged quantity to review for Fan"), {target: {value: "2"}});
    fireEvent.change(screen.getByLabelText("Damage review decision"), {target: {value: "no_charge"}});
    expect(screen.getByText(/Proposed additional branch charge/).textContent).toMatch(/0\.00/);
    fireEvent.change(screen.getByLabelText("Damage review note"), {target: {value: "Not chargeable to branch"}});
    fireEvent.click(screen.getByRole("button", {name: "Save damage review"}));
    await waitFor(() => expect(mocks.api).toHaveBeenCalledWith("stockTransfers", expect.objectContaining({action: "review_damage", decision: "no_charge", lines: [{id: "line", quantity: 2}]})));
  });
  it("shows held damage status without granting review controls", () => {
    const damaged = {...invoice, lines: [{...invoice.lines[0]!, pendingDamagedQuantity: 2}]};
    render(<><InternalTradeInvoiceCard invoice={damaged} /><InvoiceTradingActions invoice={damaged} workspace={{...workspace, canReviewDamage: false}} owner="org:user:inv-1" scope="organization" onComplete={vi.fn()} /></>);
    expect(screen.getByText(/Their charges are held and excluded/)).toBeTruthy();
    expect(screen.queryByLabelText("Damage review decision")).toBeNull();
  });

});

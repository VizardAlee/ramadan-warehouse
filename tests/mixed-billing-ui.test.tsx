// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { queueOfflineSale } from "@/features/pos/offline-store";
import { ServiceLineOptions } from "@/features/pos/service-line-options";
import { BillingReceiptCorrections } from "@/features/accounting/billing-receipt-corrections";
import { useBillingOperation } from "@/features/accounting/use-billing-operation";
import { calculatePosCart, reconcileHeldCart } from "@/features/pos/calculations";
import type { PosCartLine, PosProduct, PosWorkspace } from "@/features/pos/types";
const state = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/features/administration/api", () => ({ callAdministration: state.call }));
afterEach(() => { cleanup(); sessionStorage.clear(); vi.resetAllMocks(); });
const service: PosProduct = { id: "service", name: "Installation", sku: "SERVICE", itemKind: "service", trackingType: "quantity", unitOfMeasure: "job", unitPriceMinor: 1000, vatRateBasisPoints: 750, availableQuantity: 0, centralPriceVersion: 1 } as PosProduct;
const part: PosProduct = { ...service, id: "part", name: "Included cable", itemKind: "goods", availableQuantity: 10 };
const workspace = { branch: { id: "branch" }, products: [service, part], providers: [{ id: "provider", name: "Existing carrier", supplierType: "logistics" }], providerNextCursorId: "provider" } as PosWorkspace;
it("keeps provider funds separate from company net and carries fixed case receipts", () => {
  expect(calculatePosCart([{ product: service, quantity: 1, providerFunds: { supplierId: "provider", amountMinor: 500 }, serviceCase: { id: "case", caseNumber: "AF-1", grossMinor: 7, vatMinor: 4, paidMinor: 3 } }])).toMatchObject({ netAmountMinor: 3, vatAmountMinor: 4, grossAmountMinor: 507, providerFundsMinor: 500, priorServicePaidMinor: 3 });
  const held = reconcileHeldCart([{ productId: service.id, quantity: 1, includedParts: [{ productId: part.id, quantity: 2 }], providerFunds: { supplierId: "provider", amountMinor: 500 }, serviceCase: { id: "case", caseNumber: "AF-1", grossMinor: 1075, vatMinor: 75, paidMinor: 500 } }], [service, part]);
  expect(held.lines[0]).toMatchObject({ quantity: 1, caseVerified: false, includedParts: [{ productId: part.id, quantity: 2 }], providerFunds: { amountMinor: 500 } });
});
it("offers existing physical parts and paged canonical suppliers, and disables service edits offline", async () => {
  const change = vi.fn(); state.call.mockResolvedValue({ providers: [{ id: "provider-2", name: "Later supplier", supplierType: "mixed" }], nextCursorId: null });
  const line: PosCartLine = { product: service, quantity: 1 };
  const view = render(<ServiceLineOptions line={line} workspace={workspace} customerId="" online onChange={change}/>);
  expect(screen.queryByRole("option", { name: /Installation/ })).toBeNull();
  fireEvent.change(screen.getByLabelText("Physical part included in fee"), { target: { value: part.id } }); fireEvent.click(screen.getByRole("button", { name: "Include part in service fee" })); expect(change).toHaveBeenCalledWith(expect.objectContaining({ includedParts: [{ productId: part.id, quantity: 1 }] }));
  fireEvent.click(screen.getByRole("button", { name: "Load more existing suppliers" })); await screen.findByRole("option", { name: /Later supplier/ }); expect(state.call).toHaveBeenCalledWith("getServiceBillingCase", { action: "providers", cursorId: "provider" });
  view.rerender(<ServiceLineOptions line={line} workspace={workspace} customerId="" online={false} onChange={change}/>); expect((screen.getByLabelText("Delivery/service provider").closest("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
});
function Operation() { const operation = useBillingOperation("test-owner:provider"); return <><button disabled={!operation.ready || operation.busy} onClick={() => void operation.run("providerFunds", { action: "settle", amountMinor: 100 })}>{operation.pending ? "Retry saved payment" : "Pay provider"}</button><p>{operation.error}</p></>; }
it("retries the identical durable transaction after interrupted confirmation and reload", async () => {
  state.call.mockRejectedValue(new Error("Interrupted connection")); const view = render(<Operation/>); const pay = screen.getByRole("button", { name: "Pay provider" }); await waitFor(() => expect(pay.hasAttribute("disabled")).toBe(false)); fireEvent.click(pay); await screen.findByRole("button", { name: "Retry saved payment" }); await screen.findByText("Interrupted connection"); const first = state.call.mock.calls[0]![1]; view.unmount(); state.call.mockResolvedValue({ recorded: false }); render(<Operation/>); const retry = await screen.findByRole("button", { name: "Retry saved payment" }); await waitFor(() => expect(retry.hasAttribute("disabled")).toBe(false)); fireEvent.click(retry); await screen.findByRole("button", { name: "Pay provider" }); expect(state.call.mock.calls[1]![1]).toEqual(first); expect(sessionStorage.getItem("warehouse-billing-operation:test-owner:provider")).toBeNull();
});
it("selects original cash receipts for a debt-restoring correction and submits actual funding", async () => {
  state.call.mockImplementation(name => Promise.resolve(name === "billingReceiptCorrections" ? { saleNumber: "SALE-1", paidMinor: 1000, outstandingMinor: 75, receipts: [{ sourceType: "salePayments", id: "receipt", method: "cash", reference: "Original cash receipt", remainingMinor: 1000 }] } : {}));
  render(<BillingReceiptCorrections ownerKey="org:user" saleId="sale" accounts={[]} shifts={[{ id: "till", deviceName: "Front till" }]}/>); await screen.findByRole("option", { name: /Original cash receipt/ });
  fireEvent.change(screen.getByLabelText("Original receipt"), { target: { value: "salePayments:receipt" } }); fireEvent.change(screen.getByLabelText("Amount actually returned (₦)"), { target: { value: "1.25" } }); fireEvent.change(screen.getByLabelText("Refund method"), { target: { value: "cash" } }); fireEvent.change(screen.getByLabelText("Open funding till"), { target: { value: "till" } }); fireEvent.change(screen.getByLabelText("Actual refund reference"), { target: { value: "Payout receipt" } }); fireEvent.change(screen.getByLabelText("Correction reason"), { target: { value: "Return wrongly collected payment" } }); const submit = screen.getByRole("button", { name: "Record actual receipt refund and restore debt" }); await waitFor(() => expect(submit.hasAttribute("disabled")).toBe(false)); fireEvent.click(submit); await waitFor(() => expect(state.call.mock.calls.some(call => call[1].action === "refund")).toBe(true)); expect(state.call.mock.calls.find(call => call[1].action === "refund")![1]).toMatchObject({ saleId: "sale", sourceId: "receipt", sourceType: "salePayments", amountMinor: 125, method: "cash", shiftId: "till" });
});

it("retains an uncertain saved payment when retry permission is later denied", async () => {
  const instruction = { name: "providerFunds", input: { action: "settle", amountMinor: 100, idempotencyKey: crypto.randomUUID() } };
  sessionStorage.setItem("warehouse-billing-operation:test-owner:provider", JSON.stringify(instruction)); state.call.mockRejectedValue(Object.assign(new Error("Return to original authorized scope"), { diagnosticCode: "functions/permission-denied" }));
  render(<Operation/>); const retry = await screen.findByRole("button", { name: "Retry saved payment" }); await waitFor(() => expect(retry.hasAttribute("disabled")).toBe(false)); fireEvent.click(retry); await screen.findByText("Return to original authorized scope"); expect(JSON.parse(sessionStorage.getItem("warehouse-billing-operation:test-owner:provider")!)).toEqual(instruction);
});

it("rejects mixed bills before opening any offline storage", async () => {
  for (const line of [{ productId: "service", itemKind: "service", quantity: 1 }, { productId: "service", quantity: 1, includedParts: [{ productId: "part", quantity: 1 }] }]) await expect(queueOfflineSale({ payload: { lines: [line], payments: [] } } as Parameters<typeof queueOfflineSale>[0])).rejects.toThrow("online confirmation");
});

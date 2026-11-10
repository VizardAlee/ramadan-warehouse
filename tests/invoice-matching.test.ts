import { beforeEach, expect, it, vi } from "vitest";
const memory = vi.hoisted(() => ({ invoices: [] as Array<Record<string, unknown>>, lines: [] as Array<Record<string, unknown>> }));
vi.mock("../functions/src/admin", () => ({ db: { collection: (collection: string) => ({ where: (field: string, _op: string, value: unknown) => ({ limit: (size: number) => ({ get: async () => {
  const rows = (collection === "supplierInvoices" ? memory.invoices : memory.lines).filter(row => row[field] === value).slice(0, size);
  const docs = rows.map(row => ({ id: row.id, get: (key: string) => row[key] }));
  return { docs, size: docs.length, empty: docs.length === 0 };
} }) }) }) } }));
import { pendingOrderMatches, matchingFingerprint, matchableQuantity } from "../functions/src/procurement/invoice-matching";
beforeEach(() => { memory.invoices = []; memory.lines = []; });
const invoice = (id: string, status = "submitted", organizationId = "org") => ({ id, status, organizationId, purchaseOrderId: "po" });
const line = (id: string, quantity = 2) => ({ id: `${id}-line`, supplierInvoiceId: id, organizationId: "org", purchaseOrderId: "po", purchaseOrderItemId: "item", quantity });
it("counts existing legacy submitted attempts and excludes approved/rejected/cancelled invoices", async () => {
  memory.invoices = [invoice("a"), invoice("b"), ...["approved", "rejected", "cancelled", "paid"].map(status => invoice(status, status)), invoice("foreign", "submitted", "other")];
  memory.lines = memory.invoices.map(row => line(String(row.id)));
  const pending = await pendingOrderMatches("org", "po");
  expect(pending.invoices.map(row => row.id)).toEqual(["a", "b"]);
  expect(pending.quantities.get("item")).toBe(4);
  expect(matchableQuantity(2, 0, 4)).toBe(0);
});
it("leaves a legitimate partial remainder available while other goods await approval", () => {
  expect(matchableQuantity(10, 3, 4)).toBe(3);
  expect(matchableQuantity(10, 7, 0)).toBe(3);
});
it.each([-1, 1.5, NaN, Infinity])("fails closed on invalid quantity %s", bad => {
  expect(() => matchableQuantity(10, 0, bad)).toThrow(/reconciliation/);
});
it("fails closed when submitted invoice lines are missing or belong to another organization", async () => {
  memory.invoices = [invoice("a")];
  await expect(pendingOrderMatches("org", "po")).rejects.toThrow(/reconciliation/);
  memory.lines = [{ ...line("a"), organizationId: "other" }];
  await expect(pendingOrderMatches("org", "po")).rejects.toThrow(/reconciliation/);
});
it("fails closed instead of undercounting excessive invoice history", async () => {
  memory.invoices = Array.from({ length: 1001 }, (_, i) => invoice(String(i)));
  await expect(pendingOrderMatches("org", "po")).rejects.toMatchObject({ code: "resource-exhausted" });
});
it("fingerprints exact business instructions independently of line order, rejecting changed amounts or dates", () => {
  const request = { purchaseOrderId: "po", supplierInvoiceNumber: "INV-ONE", invoiceDate: "2026-11-09", lines: [{ purchaseOrderItemId: "b", quantity: 2 }, { purchaseOrderItemId: "a", quantity: 1 }] };
  expect(matchingFingerprint(request)).toBe(matchingFingerprint({ ...request, lines: [...request.lines].reverse() }));
  expect(matchingFingerprint(request)).not.toBe(matchingFingerprint({ ...request, invoiceDate: "2026-11-08" }));
  expect(matchingFingerprint(request)).not.toBe(matchingFingerprint({ ...request, lines: [{ purchaseOrderItemId: "b", quantity: 3 }, request.lines[1]!] }));
});

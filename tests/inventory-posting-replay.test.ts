import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessProfile } from "../functions/src/auth/authorize";

const mocks = vi.hoisted(() => ({ get: vi.fn(), getAll: vi.fn(), runTransaction: vi.fn() }));
vi.mock("../functions/src/admin.js", () => ({
  db: {
    collection: () => ({ doc: (id?: string) => ({ id: id ?? "unused-allocation", get: mocks.get }) }),
    runTransaction: mocks.runTransaction,
  },
}));
import { postInventoryTransaction, postInventoryTransactionGroup, type PostingRequest } from "../functions/src/inventory/post-inventory-transaction";

const actor = { organizationId: "replay-org", userId: "replay-user" } as AccessProfile;
const input = {
  transactionType: "inventory_receipt" as const, productId: "product", quantity: 1,
  destinationLocationId: "store", externalAccount: "supplier:test", unitCostMinor: 100,
  serialNumbers: [], effectiveAt: "2026-10-08T09:00:00.000Z", reason: "Replay regression",
  idempotencyKey: "same-receipt", correlationId: "correlation", sourceFunction: "test",
};
const posted = {
  exists: true,
  get: (field: string) => ({ transactionId: "original-posted-id", transactionNumber: "INV-2026-000123" })[field as "transactionId" | "transactionNumber"],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.runTransaction.mockImplementation(async (callback) => callback({ getAll: mocks.getAll }));
});

describe("inventory posting replay references", () => {
  it.each(["duplicate products", "duplicate line keys", "duplicate serials", "too many lines", "too many serials", "invalid document reference", "missing commercial fingerprint"])("rejects unsafe grouped documents before a transaction: %s", async kind => {
    const second = { ...input, productId: "second-product", idempotencyKey: "second-line" };
    let inputs: PostingRequest[] = [input, second];
    let document = { idempotencyKey: "document-key", requestFingerprint: "a".repeat(64) };
    if (kind === "duplicate products") inputs = [input, { ...second, productId: input.productId }];
    if (kind === "duplicate line keys") inputs = [input, { ...second, idempotencyKey: input.idempotencyKey }];
    if (kind === "duplicate serials") inputs = [{ ...input, serialNumbers: ["SERIAL-1"] }, { ...second, serialNumbers: [" serial-1 "] }];
    if (kind === "too many lines") inputs = Array.from({ length: 11 }, (_, index) => ({ ...input, productId: `product-${index}`, idempotencyKey: `line-${index}` }));
    if (kind === "too many serials") inputs = [{ ...input, serialNumbers: Array.from({ length: 51 }, (_, index) => `serial-${index}`) }];
    if (kind === "invalid document reference") document = { ...document, idempotencyKey: "bad/reference" };
    if (kind === "missing commercial fingerprint") document = { ...document, requestFingerprint: "" };
    await expect(postInventoryTransactionGroup(actor, document, inputs, { prepare: vi.fn(), apply: vi.fn() })).rejects.toMatchObject({ code: "invalid-argument" });
    expect(mocks.runTransaction).not.toHaveBeenCalled();
  });

  it("returns the original posted reference on an ordinary retry", async () => {
    mocks.get.mockResolvedValue(posted);
    await expect(postInventoryTransaction(actor, input)).resolves.toEqual({
      transactionId: "original-posted-id", transactionNumber: "INV-2026-000123", posted: false,
    });
    expect(mocks.runTransaction).not.toHaveBeenCalled();
  });

  it("returns the original reference when another request posts after the initial read", async () => {
    mocks.get.mockResolvedValue({ exists: false });
    mocks.getAll.mockResolvedValue([posted]);
    await expect(postInventoryTransaction(actor, input)).resolves.toEqual({
      transactionId: "original-posted-id", transactionNumber: "INV-2026-000123", posted: false,
    });
    expect(mocks.runTransaction).toHaveBeenCalledOnce();
  });

  it.each([true, false])("does not repeat linked financial callbacks on replay (initial=%s)", async (initial) => {
    const extension = { prepare: vi.fn(), apply: vi.fn() };
    mocks.get.mockResolvedValue(initial ? posted : { exists: false });
    mocks.getAll.mockResolvedValue([posted]);
    await expect(postInventoryTransaction(actor, input, extension)).resolves.toMatchObject({
      transactionId: "original-posted-id", posted: false,
    });
    expect(extension.prepare).not.toHaveBeenCalled();
    expect(extension.apply).not.toHaveBeenCalled();
  });
});

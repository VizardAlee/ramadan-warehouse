import { HttpsError } from "firebase-functions/v2/https";
import type { z } from "zod";
import { db } from "../admin.js";
import { balanceDocumentId, issueCost, normalizeInventoryIdentifier } from "../inventory/calculations.js";
import { readSaleSerials, serialCost } from "../sales/serials.js";
import type { commitSaleInput } from "../validation/sales.js";
export interface StockState { product: FirebaseFirestore.DocumentSnapshot; snapshot: FirebaseFirestore.DocumentSnapshot; balance: ReturnType<typeof issueCost>["balance"]; reserved: number }
export interface PartIssue { parentIndex: number; product: FirebaseFirestore.DocumentSnapshot; quantity: number; serials: FirebaseFirestore.DocumentSnapshot[]; beforeQuantity: number; issued: ReturnType<typeof issueCost> }
export async function prepareIncludedStock(tx: FirebaseFirestore.Transaction, scope: { organizationId: string; locationId: string; saleId: string }, input: z.infer<typeof commitSaleInput>) {
  const parts = input.lines.flatMap((line, parentIndex) => (line.includedParts ?? []).map(part => ({ ...part, parentIndex })));
  const allSerials = input.lines.flatMap(line => [...line.serialNumbers ?? [], ...line.includedParts?.flatMap(part => part.serialNumbers ?? []) ?? []]).map(normalizeInventoryIdentifier);
  if (allSerials.length > 50 || new Set(allSerials).size !== allSerials.length) throw new HttpsError("invalid-argument", "Use each physical serial once across charged and included parts; at most 50 per bill.");
  const products = parts.length ? await tx.getAll(...parts.map(part => db.doc(`products/${part.productId}`))) : [];
  const balances = parts.length ? await tx.getAll(...parts.map(part => db.doc(`inventoryBalances/${balanceDocumentId(scope.organizationId, part.productId, scope.locationId)}`))) : [];
  const serials = await readSaleSerials(tx, scope, parts.map((part, index) => ({ ...part, trackingType: String(products[index]!.get("trackingType")) })), "sell");
  return parts.map((part, index) => ({ ...part, product: products[index]!, snapshot: balances[index]!, serials: serials[index]! }));
}
export function planStock(states: Map<string, StockState>, scope: { organizationId: string; locationId: string }, product: FirebaseFirestore.DocumentSnapshot, snapshot: FirebaseFirestore.DocumentSnapshot, quantity: number, reserve: boolean, serials: FirebaseFirestore.DocumentSnapshot[]) {
  if (!product.exists || product.get("organizationId") !== scope.organizationId || product.get("active") !== true || product.get("itemKind") === "service" || !["quantity", "serial"].includes(product.get("trackingType"))) throw new HttpsError("failed-precondition", "Select active physical quantity/serial goods for charged or included parts.");
  let state = states.get(product.id);
  if (!state) {
    state = { product, snapshot, balance: { quantity: Number(snapshot.get("onHandQuantity") ?? 0), totalValueMinor: Number(snapshot.get("totalValueMinor") ?? 0), averageUnitCostMinor: Number(snapshot.get("averageUnitCostMinor") ?? 0) }, reserved: Number(snapshot.get("reservedQuantity") ?? 0) };
    if (!snapshot.exists || snapshot.get("organizationId") !== scope.organizationId || snapshot.get("locationId") !== scope.locationId || snapshot.get("productId") !== product.id || ![...Object.values(state.balance), state.reserved].every(value => Number.isSafeInteger(value) && value >= 0)) throw new HttpsError("failed-precondition", "Stock evidence requires reconciliation before billing.");
    states.set(product.id, state);
  }
  if (state.balance.quantity - state.reserved < quantity) throw new HttpsError("failed-precondition", "Insufficient stock across charged goods and included parts.", { code: "POS_STOCK_RECONCILIATION_REQUIRED", productId: product.id });
  const beforeQuantity = state.balance.quantity, reservedBefore = state.reserved;
  const issued = issueCost(state.balance, quantity, serials.length ? serialCost(serials) : undefined);
  if (serials.length && quantity === state.balance.quantity && issued.movementValueMinor !== state.balance.totalValueMinor) throw new HttpsError("failed-precondition", "Serial costs and stock valuation disagree. Reconcile before billing.");
  if (reserve) state.reserved += quantity; else state.balance = issued.balance;
  return { issued, beforeQuantity, reservedBefore };
}

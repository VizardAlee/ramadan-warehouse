import { randomUUID } from "node:crypto";
import { FieldPath, FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { db } from "../admin.js";
import { hasServerPermission, requirePermission, type AccessProfile } from "../auth/authorize.js";
import { scopedAccess, hasPermissionScope, requirePermissionScope } from "../auth/permission-scope.js";
import { requestFingerprint } from "../utils/request-fingerprint.js";
import { uniquenessDocumentId } from "../inventory/calculations.js";
import { calculateSale } from "./calculations.js";
import { resolveCatalogPrice } from "./pricing.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import { parseInput } from "../utils/callable.js";
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const proformaInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create_proforma"), branchId: id, customerId: id.optional(), customerName: z.string().trim().min(2).max(160).optional(), validUntil: z.string().date(), notes: z.string().trim().max(500).optional(), discountAmountMinor: z.number().int().nonnegative().safe().default(0), discountReason: z.string().trim().max(500).optional(), lines: z.array(z.object({ productId: id, quantity: z.number().int().positive().max(100000), priceTier: z.enum(["retail", "wholesale"]).default("retail") }).strict()).min(1).max(50), idempotencyKey: z.string().uuid() }).strict(),
  z.object({ action: z.literal("get_proforma"), proformaId: id }).strict(),
  z.object({ action: z.literal("list_proformas"), branchId: id, cursorId: id.optional(), limit: z.number().int().min(1).max(100).default(25) }).strict(),
]);
const fail = (message: string): never => { throw new HttpsError("failed-precondition", message); };
function view(record: FirebaseFirestore.DocumentSnapshot) {
  return { id: record.id, ...record.data(), createdAt: record.get("createdAt") instanceof Timestamp ? record.get("createdAt").toDate().toISOString() : null, expiresAt: record.get("expiresAt") instanceof Timestamp ? record.get("expiresAt").toDate().toISOString() : null };
}
export async function proformaRequest(actor: AccessProfile, data: unknown) {
  // Transport operatingContext is authorization metadata, never quote content.
  const raw = { ...(data as Record<string, unknown>) }; delete raw.operatingContext;
  const input = parseInput(proformaInput, raw);
  const access = await scopedAccess(actor), readPermissions = ["sales.order.create", "sales.create", "sales.read.own_branch", "sales.read.all", "reports.sales.read"] as const;
  if (!readPermissions.some(permission => hasServerPermission(access, permission))) throw new HttpsError("permission-denied", "Proforma access requires your existing sales authority.");
  const requireReadScope = (branchId: string) => { if (!readPermissions.some(permission => hasPermissionScope(access, { branchId }, permission))) throw new HttpsError("permission-denied", "This proforma is outside your sales-reading authority for the store."); };
  if (input.action === "get_proforma") {
    const quote = await db.doc(`proformaQuotes/${input.proformaId}`).get();
    if (!quote.exists || quote.get("organizationId") !== actor.organizationId) throw new HttpsError("not-found", "Proforma not found.");
    requireReadScope(String(quote.get("branchId"))); return view(quote);
  }
  requireReadScope(input.branchId);
  if (input.action === "list_proformas") {
    let query = db.collection("proformaQuotes").where("organizationId", "==", actor.organizationId).where("branchId", "==", input.branchId).orderBy(FieldPath.documentId(), "desc");
    if (input.cursorId) { const cursor = await db.doc(`proformaQuotes/${input.cursorId}`).get(); if (!cursor.exists || cursor.get("organizationId") !== actor.organizationId || cursor.get("branchId") !== input.branchId) throw new HttpsError("invalid-argument", "Restart proforma history for this store."); query = query.startAfter(cursor); }
    const records = await query.limit(input.limit + 1).get(), rows = records.docs.slice(0,input.limit);
    return { rows: rows.map(view), nextCursorId: records.size > input.limit ? rows.at(-1)!.id : null };
  }
  requirePermission(actor, "sales.order.create");
  // A separate global read grant must not broaden local quote-creation authority.
  requirePermissionScope(access, { branchId: input.branchId }, "sales.order.create");
  if (new Set(input.lines.map(line => line.productId)).size !== input.lines.length) throw new HttpsError("invalid-argument", "Quote each product once.");
  const expiresAt = Timestamp.fromDate(new Date(`${input.validUntil}T23:59:59.999+01:00`));
  if (input.discountAmountMinor && (input.discountReason?.length ?? 0) < 3) throw new HttpsError("invalid-argument", "Explain the quoted discount.");
  const operation = db.doc(`idempotencyOperations/${uniquenessDocumentId(actor.organizationId, "proforma", input.idempotencyKey)}`), quote = db.doc(`proformaQuotes/p_${Date.now()}_${randomUUID().slice(0,8)}`), fingerprint = requestFingerprint(input);
  await db.runTransaction(async tx => {
    const previous = await tx.get(operation);
    if (previous.exists) { if (previous.get("organizationId") !== actor.organizationId || previous.get("fingerprint") !== fingerprint) fail("Retry the original quote instructions without changes."); return; }
    if (expiresAt.toMillis() < Date.now() || expiresAt.toMillis() > Date.now() + 366 * 86400000) throw new HttpsError("invalid-argument", "Choose a quote expiry from today through the next year.");
    const [branch, organization, customer] = await tx.getAll(db.doc(`branches/${input.branchId}`), db.doc(`organizations/${actor.organizationId}`), db.doc(`customers/${input.customerId ?? "no-quoted-customer"}`));
    if (!branch!.exists || branch!.get("organizationId") !== actor.organizationId || branch!.get("status") !== "active") fail("Quote store is unavailable.");
    if (input.customerId && (!customer!.exists || customer!.get("organizationId") !== actor.organizationId || customer!.get("active") !== true)) fail("Choose an active customer in this organization.");
    const records = await tx.getAll(...input.lines.flatMap(line => [db.doc(`products/${line.productId}`), db.doc(`productSalesPrices/${line.productId}`), db.doc(`branchSalesPrices/${uniquenessDocumentId(actor.organizationId, "branchSalesPrice", input.branchId, line.productId)}`)]));
    const lines = input.lines.map((line, index) => {
      const product = records[index * 3]!, central = records[index * 3 + 1]!, branchPrice = records[index * 3 + 2]!;
      if (!product.exists || product.get("organizationId") !== actor.organizationId || product.get("active") !== true || !central.exists || central.get("organizationId") !== actor.organizationId || central.get("active") !== true || (branchPrice.exists && (branchPrice.get("organizationId") !== actor.organizationId || branchPrice.get("branchId") !== input.branchId))) fail("A quoted product or price is unavailable.");
      let resolved;
      try { resolved = resolveCatalogPrice({ basePriceMinor: central.get("basePriceMinor"), version: central.get("version"), wholesalePriceMinor: central.get("wholesalePriceMinor") }, branchPrice.data() ?? {}, line.priceTier); }
      catch (cause) { throw new HttpsError("failed-precondition", cause instanceof Error ? cause.message : "Quoted pricing requires review."); }
      if (!Number.isSafeInteger(resolved.unitPriceMinor) || resolved.unitPriceMinor <= 0) fail("Configure a positive catalogue price before quoting this product.");
      return { ...line, productName: String(product.get("name")), sku: String(product.get("sku")), unitOfMeasure: product.get("unitOfMeasure") ?? "unit", itemKind: product.get("itemKind") ?? "goods", unitPriceMinor: resolved.unitPriceMinor, vatRateBasisPoints: Number(central.get("vatRateBasisPoints") ?? 0), unitCostMinor: 0 };
    });
    let calculated; try { calculated = calculateSale(lines, input.discountAmountMinor); } catch (cause) { throw new HttpsError("invalid-argument", cause instanceof Error ? cause.message : "Quote totals are invalid."); }
    const now = FieldValue.serverTimestamp(), number = `PF-${quote.id.slice(2).toUpperCase()}`;
    tx.create(quote, { organizationId: actor.organizationId, branchId: input.branchId, branchName: branch!.get("name"), companyName: organization!.get("tradingName") || organization!.get("legalName"), companyAddress: organization!.get("address") ?? null, customerId: input.customerId ?? null, customerName: input.customerId ? customer!.get("name") : input.customerName || "Prospective customer", number, status: "proforma", currency: "NGN", validUntil: input.validUntil, expiresAt, notes: input.notes ?? null, discountReason: input.discountReason ?? null, subtotalAmountMinor: calculated.subtotalAmountMinor, discountAmountMinor: calculated.discountAmountMinor, netAmountMinor: calculated.netAmountMinor, vatAmountMinor: calculated.vatAmountMinor, grossAmountMinor: calculated.grossAmountMinor, lines: lines.map((line,index) => ({ ...line, ...calculated.lines[index] })), createdAt: now, createdBy: actor.userId });
    tx.create(operation, { organizationId: actor.organizationId, fingerprint, proformaId: quote.id, createdAt: now });
    writeAuditLog(tx, actor, { action: "sale.proforma_created", entityType: "proformaQuote", entityId: quote.id, sourceFunction: "createPosSaleOrder", correlationId: input.idempotencyKey, after: { number, branchId: input.branchId, grossAmountMinor: calculated.grossAmountMinor, nonPosting: true } });
  });
  const saved = await operation.get(); return { proformaId: saved.get("proformaId"), saved: true };
}
export async function validateProformaReference(tx: FirebaseFirestore.Transaction, actor: AccessProfile, input: { proformaId?: string; branchId: string; customerId?: string }, allowExpired = false) {
  if (!input.proformaId) return;
  const quote = await tx.get(db.doc(`proformaQuotes/${input.proformaId}`));
  if (!quote.exists || quote.get("organizationId") !== actor.organizationId || quote.get("branchId") !== input.branchId || (quote.get("customerId") && quote.get("customerId") !== input.customerId)) fail("This proforma does not belong to the selected store/customer.");
  if (!allowExpired && (!(quote.get("expiresAt") instanceof Timestamp) || quote.get("expiresAt").toMillis() < Date.now())) fail("This proforma expired. Issue a new quote or start a new sale with current terms.");
}

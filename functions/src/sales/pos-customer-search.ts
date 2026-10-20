import { createHash } from "node:crypto";
import { FieldPath, type DocumentSnapshot, type Query, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import { customerArrangements } from "./customer-arrangements.js";
import { moneyBalances } from "./receivables.js";

export function normalizeCustomerName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

/** Exactly the existing POS projection; never return the customer register document. */
export function posCustomerSummary(customer: DocumentSnapshot) {
  return {
    id: customer.id,
    customerNumber: customer.get("customerNumber"),
    name: customer.get("name"),
    pricingTier: customer.get("pricingTier") ?? "retail",
    arrangements: customerArrangements(customer.data() ?? {}),
    advanceBalances: moneyBalances(customer.get("advanceBalances")),
    phone: customer.get("phone") ?? null,
    creditStatus: customer.get("creditStatus") ?? "pending",
    creditLimitMinor: Number(customer.get("creditLimitMinor") ?? 0),
    outstandingBalanceMinor: Number(customer.get("outstandingBalanceMinor") ?? 0),
    availableCreditMinor: Number(customer.get("availableCreditMinor") ?? 0),
  };
}

export async function readPosCustomer(organizationId: string, customerId: string) {
  const customer = await db.doc(`customers/${customerId}`).get();
  return customer.exists && customer.get("organizationId") === organizationId && customer.get("active") === true ? posCustomerSummary(customer) : null;
}

export async function searchPosCustomers(
  scope: { organizationId: string; userId: string; branchId: string },
  input: { query: string; cursor?: string; limit: number },
) {
  const term = normalizeCustomerName(input.query);
  const fingerprint = createHash("sha256").update(JSON.stringify([scope.organizationId, scope.userId, scope.branchId, term, input.limit])).digest("hex");
  // Substring search includes legacy names without requiring a migration or a new index.
  // Bound each scan and expose continuation rather than silently stopping at the workspace cap.
  let query: Query = db.collection("customers").where("organizationId", "==", scope.organizationId)
    .orderBy(FieldPath.documentId(), "asc");
  if (input.cursor) {
    let cursor: { id: string; fingerprint: string };
    try {
      cursor = JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8")) as typeof cursor;
      if (!cursor || cursor.fingerprint !== fingerprint || typeof cursor.id !== "string" || !cursor.id || cursor.id.length > 128 || cursor.id.includes("/") || [".", ".."].includes(cursor.id) || /[\u0000-\u001f\u007f]/u.test(cursor.id)) throw Error("Invalid cursor");
    } catch { throw new HttpsError("invalid-argument", "Restart this customer search; its page is no longer available."); }
    const anchor = await db.doc(`customers/${cursor.id}`).get();
    if (!anchor.exists || anchor.get("organizationId") !== scope.organizationId) throw new HttpsError("invalid-argument", "Restart this customer search; its page is no longer available.");
    query = query.startAfter(anchor);
  }
  const matches: QueryDocumentSnapshot[] = [];
  let scanned = 0, last: QueryDocumentSnapshot | undefined, hasMore = false;
  while (scanned < 1000 && matches.length < input.limit) {
    const limit = Math.min(100, 1000 - scanned), page = await query.limit(limit).get();
    if (page.empty) { hasMore = false; break; }
    let processed = 0;
    for (const customer of page.docs) {
      last = customer; scanned++; processed++;
      const name: unknown = customer.get("name");
      if (customer.get("active") === true && typeof name === "string" && normalizeCustomerName(name).includes(term)) matches.push(customer);
      if (matches.length === input.limit) break;
    }
    hasMore = processed < page.size || page.size === limit;
    if (!hasMore || !last) break;
    query = query.startAfter(last);
  }
  return {
    customers: matches.map(posCustomerSummary),
    nextCursor: hasMore && last ? Buffer.from(JSON.stringify({ id: last.id, fingerprint })).toString("base64url") : null,
    scanned,
    scanLimited: hasMore && scanned === 1000,
    complete: !hasMore,
  };
}

import { createHash } from "node:crypto";
import { HttpsError } from "firebase-functions/v2/https";
import type { z } from "zod";
import type { expenseWorkspaceInput } from "../validation/expenses.js";

export type ExpenseWorkspaceInput = z.infer<typeof expenseWorkspaceInput>;
export const expenseScanLimit = 500;
const normalize = (value: string) => value.normalize("NFKC").toLowerCase().trim();

export function expenseMatches(row: FirebaseFirestore.DocumentData, input: ExpenseWorkspaceInput) {
  if (input.status === "ready" ? !["approved", "partially_paid"].includes(row.status) : input.status !== "all" && row.status !== input.status) return false;
  if (input.fromDate && (typeof row.expenseDate !== "string" || row.expenseDate < input.fromDate)) return false;
  if (input.toDate && (typeof row.expenseDate !== "string" || row.expenseDate > input.toDate)) return false;
  if (!input.search) return true;
  return [row.expenseNumber, row.categoryName, row.payeeName, row.supplierDocumentNumber, row.description, row.costReferenceLabel]
    .some(value => typeof value === "string" && normalize(value).includes(normalize(input.search)));
}

// Binding prevents accidentally reusing a page in another identity, scope or filter.
// Authorization is always enforced on the query and returned records, not by this cursor.
export function expenseCursorBinding(organizationId: string, userId: string, input: ExpenseWorkspaceInput) {
  return createHash("sha256").update(JSON.stringify([organizationId, userId, input.branchId ?? "", input.warehouseId ?? "", input.status,
    normalize(input.search), input.fromDate ?? "", input.toDate ?? "", input.limit])).digest("hex");
}
export function readExpenseCursor(cursor: string | undefined, binding: string): string | undefined {
  if (!cursor) return undefined;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (value.version !== 1 || value.binding !== binding || typeof value.after !== "string" || !value.after || value.after.length > 128 || value.after.includes("/") || [".", ".."].includes(value.after)) throw new Error("cursor");
    return value.after;
  } catch {
    throw new HttpsError("invalid-argument", "This expense page belongs to different filters or access. Return to the first page and refresh.");
  }
}
export function expenseCursor(after: string, binding: string) {
  return Buffer.from(JSON.stringify({ version: 1, after, binding })).toString("base64url");
}

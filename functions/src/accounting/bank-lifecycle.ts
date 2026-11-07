import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import type { AccessProfile } from "../auth/authorize.js";
import { uniquenessDocumentId } from "../inventory/calculations.js";
import { writeAuditLog } from "../audit/write-audit-log.js";
import { correlationId } from "../utils/callable.js";

export function bankReviewRequired(message: string): never {
  throw new HttpsError("failed-precondition", message, { code: "OPERATIONAL_EVIDENCE_ACTION_REQUIRED", userMessage: message });
}
export async function bankLedgerEvidence(tx: FirebaseFirestore.Transaction, organizationId: string, bank: FirebaseFirestore.DocumentSnapshot) {
  const code = String(bank.get("ledgerAccountCode") ?? "");
  if (!/^10\d{2}$/.test(code) || code === "1010") bankReviewRequired("This financial account's ledger mapping requires accountant review.");
  const results = await Promise.all(["bankAccountId", "accountCode"].map(field => tx.get(db.collection("journalLines").where("organizationId", "==", organizationId).where(field, "==", field === "bankAccountId" ? bank.id : code).limit(501))));
  if (results.some(result => result.size > 500)) bankReviewRequired("This account has too much history for an automatic lifecycle review. Ask an accountant to review it.");
  return [...new Map(results.flatMap(result => result.docs).map(doc => [doc.id, doc])).values()];
}
// Include records that can exist before a journal is posted, and nested split tenders.
const dependencyCollections = ["journalEntries", "bankStatementTransactions", "bankReconciliations", "salePayments", "customerPayments", "supplierPayments", "expensePayments", "aftersalesPayments", "providerFundPayments", "saleReturns", "saleRefunds", "sales", "salesOrders", "expenses", "purchaseOrders", "internalTradePayments"];
function referencesBank(value: unknown, id: string, code: string): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(item => referencesBank(item, id, code));
  return Object.entries(value).some(([key, item]) => /bankAccountId$/i.test(key) && item === id || /^(accountCode|ledgerAccountCode)$/i.test(key) && item === code || referencesBank(item, id, code));
}
export async function hasBankDependencies(tx: FirebaseFirestore.Transaction, organizationId: string, bank: FirebaseFirestore.DocumentSnapshot) {
  if (bank.get("openingJournalEntryId") || Number(bank.get("openingBalanceMinor") ?? 0) !== 0) return true;
  const code = String(bank.get("ledgerAccountCode") ?? "");
  if (!/^10\d{2}$/.test(code) || code === "1010") return true;
  for (const [field, value] of [["bankAccountId", bank.id], ["accountCode", code]]) {
    if (!(await tx.get(db.collection("journalLines").where("organizationId", "==", organizationId).where(field!, "==", value).limit(1))).empty) return true;
  }
  for (const collection of dependencyCollections) {
    const records = await tx.get(db.collection(collection).where("organizationId", "==", organizationId).limit(501));
    // Unbounded legacy evidence must never be silently declared unused.
    if (records.size > 500) return true;
    if (records.docs.some(record => referencesBank(record.data(), bank.id, code))) return true;
  }
  const financialAudits = await tx.get(db.collection("auditLogs").where("organizationId", "==", organizationId).where("sourceFunction", "in", ["recordCompanyFundsTransfer", "recordCustomerPayment", "recordSupplierPayment", "recordExpensePayment", "recordAftersalesPayment", "approveSaleReturn", "accountingJournals"]).limit(501));
  if (financialAudits.size > 500 || financialAudits.docs.some(record => referencesBank(record.get("before"), bank.id, code) || referencesBank(record.get("after"), bank.id, code))) return true;
  return false;
}
export async function bankLifecycle(actor: AccessProfile, input: { action: "lifecycle_preview" | "remove" | "restore"; bankAccountId: string; reason?: string; idempotencyKey?: string }) {
  const ref = db.doc(`bankAccounts/${input.bankAccountId}`);
  const operation = input.idempotencyKey ? db.doc(`idempotencyOperations/${uniquenessDocumentId(actor.organizationId, "bankLifecycle", input.idempotencyKey)}`) : undefined;
  const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  return db.runTransaction(async tx => {
    if (operation) {
      const previous = await tx.get(operation);
      if (previous.exists) {
        if (previous.get("organizationId") !== actor.organizationId || previous.get("fingerprint") !== fingerprint) bankReviewRequired("This retry key belongs to different account instructions.");
        return previous.get("result");
      }
    }
    const bank = await tx.get(ref);
    if (!bank.exists || bank.get("organizationId") !== actor.organizationId) throw new HttpsError("not-found", "Bank account not found.");
    if (input.action === "restore") {
      const code = String(bank.get("ledgerAccountCode") ?? "");
      if (!/^10\d{2}$/.test(code) || code === "1010" || bank.get("currency") !== "NGN") bankReviewRequired("This account's currency or bank ledger mapping needs review before restoration.");
      const peers = await tx.get(db.collection("bankAccounts").where("organizationId", "==", actor.organizationId).where("ledgerAccountCode", "==", code).limit(2));
      const charts = await tx.get(db.collection("chartOfAccounts").where("organizationId", "==", actor.organizationId).where("code", "==", code).limit(2));
      const chart = charts.docs[0];
      if (peers.size !== 1 || peers.docs[0]?.id !== bank.id || charts.size !== 1 || chart?.id !== uniquenessDocumentId(actor.organizationId, code) || (chart.get("bankAccountId") && chart.get("bankAccountId") !== bank.id) || chart.get("currency") !== "NGN" || chart.get("active") !== true || chart.get("billingControlPurpose")) bankReviewRequired("The bank's unique ledger mapping requires review before restoration.");
    }
    const hasDependencies = await hasBankDependencies(tx, actor.organizationId, bank);
    const removalMode = hasDependencies ? "archive" : "remove";
    const lifecycleStatus = input.action === "lifecycle_preview" ? bank.get("lifecycleStatus") ?? (bank.get("active") ? "active" : "archived") : input.action === "restore" ? "active" : hasDependencies ? "archived" : "removed";
    const result = { bankAccountId: bank.id, hasDependencies, removalMode, lifecycleStatus, saved: input.action !== "lifecycle_preview" };
    if (input.action === "lifecycle_preview") return result;
    // Tombstones retain the bank id and uniqueness lock. No financial history is deleted.
    tx.update(ref, { lifecycleStatus, active: lifecycleStatus === "active", lifecycleReason: input.reason, lifecycleChangedAt: FieldValue.serverTimestamp(), lifecycleChangedBy: actor.userId });
    tx.create(operation!, { organizationId: actor.organizationId, fingerprint, result, createdAt: FieldValue.serverTimestamp() });
    writeAuditLog(tx, actor, { action: `bank_account.${input.action === "restore" ? "restored" : lifecycleStatus}`, entityType: "bankAccount", entityId: bank.id, correlationId: correlationId(), sourceFunction: "saveBankAccount", reason: input.reason, after: result });
    return result;
  });
}

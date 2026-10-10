import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import type { AccessProfile } from "../auth/authorize.js";
import { uniquenessDocumentId } from "../inventory/calculations.js";
import { assertSafeJournal } from "./journal-validation.js";

export const accountNames: Readonly<Record<string, string>> = {
  "1010": "Cash on hand",
  "1020": "Card clearing",
  "1030": "Bank transfer clearing",
  "1200": "Inventory asset",
  "1250": "Supplier advances and credits",
  "1300": "Input VAT recoverable",
  "2000": "Accounts payable",
  "5000": "Cost of sales",
  "5010": "Supplier return inventory valuation variance",
};
function clean(values: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== ""));
}
export function writeJournal(
  transaction: Pick<FirebaseFirestore.Transaction, "create" | "set">,
  actor: AccessProfile,
  values: {
    journal: FirebaseFirestore.DocumentReference;
    journalCounter: FirebaseFirestore.DocumentReference;
    journalCounterValue: number;
    journalType: string;
    referenceType: string;
    referenceId: string;
    referenceNumber: string;
    description: string;
    details?: Record<string, unknown>;
    manageAccounts?: boolean;
    cashFlowActivity?: "operating" | "investing" | "financing";
    branchId?: string;
    warehouseId?: string;
    effectiveAt: Timestamp;
    lines: Array<{
      accountCode: string;
      accountId?: string;
      bankAccountId?: string;
      accountName?: string;
      debitMinor: number;
      creditMinor: number;
    }>;
  },
) {
  assertSafeJournal(values.lines);
  if (!Number.isSafeInteger(values.journalCounterValue) || values.journalCounterValue < 1)
    throw new HttpsError("failed-precondition", "The journal counter requires reconciliation.");
  const now = FieldValue.serverTimestamp();
  const journalNumber = `JRN-${new Date().getUTCFullYear()}-${String(values.journalCounterValue).padStart(6, "0")}`;
  transaction.set(values.journalCounter, {
    organizationId: actor.organizationId,
    kind: "journalEntry",
    value: values.journalCounterValue,
    updatedAt: now,
  });
  transaction.create(
    values.journal,
    clean({
      organizationId: actor.organizationId,
      branchId: values.branchId,
      warehouseId: values.warehouseId,
      journalNumber,
      journalType: values.journalType,
      status: "posted",
      referenceType: values.referenceType,
      referenceId: values.referenceId,
      referenceNumber: values.referenceNumber,
      description: values.description,
      details: values.details,
      cashFlowActivity: values.cashFlowActivity,
      totalDebitMinor: values.lines.reduce(
        (sum, line) => sum + line.debitMinor,
        0,
      ),
      totalCreditMinor: values.lines.reduce(
        (sum, line) => sum + line.creditMinor,
        0,
      ),
      currency: "NGN",
      effectiveAt: values.effectiveAt,
      postedAt: now,
      postedBy: actor.userId,
      createdAt: now,
    }),
  );
  for (const line of values.lines) {
    const account = db.doc(
      `chartOfAccounts/${line.accountId ?? uniquenessDocumentId(actor.organizationId, line.accountCode)}`,
    );
    if (values.manageAccounts !== false && !line.accountId) transaction.set(
      account,
      {
        organizationId: actor.organizationId,
        code: line.accountCode,
        name: line.accountName ?? accountNames[line.accountCode] ?? line.accountCode,
        currency: "NGN",
        active: true,
        systemManaged: true,
        updatedAt: now,
      },
      { merge: true },
    );
    transaction.create(
      db.collection("journalLines").doc(),
      clean({
        organizationId: actor.organizationId,
        branchId: values.branchId,
        warehouseId: values.warehouseId,
        journalEntryId: values.journal.id,
        journalNumber,
        accountId: account.id,
        accountCode: line.accountCode,
        accountName: line.accountName ?? accountNames[line.accountCode] ?? line.accountCode,
        bankAccountId: line.bankAccountId,
        debitMinor: line.debitMinor,
        creditMinor: line.creditMinor,
        currency: "NGN",
        effectiveAt: values.effectiveAt,
        createdAt: now,
      }),
    );
  }
  return journalNumber;
}

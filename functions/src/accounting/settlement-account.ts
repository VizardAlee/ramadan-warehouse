import { HttpsError } from "firebase-functions/v2/https";

export type SettlementMethod = "cash" | "card" | "bank_transfer";

export interface ResolvedSettlementAccount {
  accountCode: string;
  accountName: string;
  bankAccountId?: string;
  bankName?: string;
  bankAccountName?: string;
  accountNumberLast4?: string;
}

export function resolveSettlementAccount(
  organizationId: string,
  method: SettlementMethod,
  bankAccountId: string | undefined,
  bankAccount: FirebaseFirestore.DocumentSnapshot | undefined,
): ResolvedSettlementAccount {
  if (method === "cash")
    return { accountCode: "1010", accountName: "Cash on hand" };

  if (!bankAccountId || !bankAccount?.exists)
    throw new HttpsError(
      "failed-precondition",
      "Select the company bank account used for this payment.",
    );
  if (
    bankAccount.id !== bankAccountId ||
    bankAccount.get("organizationId") !== organizationId ||
    bankAccount.get("active") !== true
  )
    throw new HttpsError(
      "failed-precondition",
      "The selected company bank account is unavailable.",
    );

  const accountCode = String(bankAccount.get("ledgerAccountCode") ?? "").trim();
  if (!accountCode)
    throw new HttpsError(
      "failed-precondition",
      "The selected company bank account has no ledger account configured.",
    );
  const bankName = String(bankAccount.get("bankName") ?? "Bank");
  const bankAccountName = String(bankAccount.get("accountName") ?? "Company account");
  const accountNumberLast4 = String(bankAccount.get("accountNumberLast4") ?? "");
  return {
    accountCode,
    accountName: `${bankName} · ${bankAccountName}${accountNumberLast4 ? ` · ••••${accountNumberLast4}` : ""}`,
    bankAccountId,
    bankName,
    bankAccountName,
    accountNumberLast4,
  };
}

export function bankAccountSummary(
  document: FirebaseFirestore.QueryDocumentSnapshot,
) {
  return {
    id: document.id,
    bankName: document.get("bankName"),
    accountName: document.get("accountName"),
    accountNumberLast4: document.get("accountNumberLast4"),
    ledgerAccountCode: document.get("ledgerAccountCode"),
  };
}

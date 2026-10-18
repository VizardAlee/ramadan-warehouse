import { resolveSettlementAccount } from "./settlement-account.js";
import type { MoneyTender } from "./money-tenders.js";

export function paymentTenders(input: { tenders?: MoneyTender[]; method: MoneyTender["method"]; bankAccountId?: string; reference?: string }, total: number): MoneyTender[] {
  return input.tenders ?? [{ method: input.method, amountMinor: total,
    ...(input.bankAccountId ? { bankAccountId: input.bankAccountId } : {}),
    ...(input.reference ? { reference: input.reference } : {}),
  }];
}

export function resolvePaymentTenders(organizationId: string, parts: readonly MoneyTender[], banks: readonly FirebaseFirestore.DocumentSnapshot[], scope: { branchId?: string } = {}) {
  return parts.map(part => ({ ...part, ...resolveSettlementAccount(organizationId, part.method, part.bankAccountId, banks.find(bank => bank.id === part.bankAccountId), scope) }));
}

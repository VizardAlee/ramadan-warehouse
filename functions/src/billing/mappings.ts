import { HttpsError } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import type { BillingAccount, BillingMapping } from "./allocations.js";
const fail = (): never => { throw new HttpsError("failed-precondition", "Configure reviewed, distinct active NGN deferred-service and provider-payable liability accounts before mixed billing. Missing or changed control evidence requires reconciliation."); };
export async function readBillingMapping(transaction: FirebaseFirestore.Transaction, organizationId: string, snapshot?: BillingMapping): Promise<BillingMapping> {
  const config = snapshot ?? (await transaction.get(db.doc(`billingConfigurations/${organizationId}`))).get("mapping") as BillingMapping | undefined;
  if (!config || !Number.isSafeInteger(config.version) || config.version < 1 || !config.deferredService?.id || !config.providerPayable?.id || config.deferredService.id === config.providerPayable.id || config.deferredService.code === config.providerPayable.code) return fail();
  for (const [purpose, account] of [["deferred_service", config.deferredService], ["provider_payable", config.providerPayable]] as const) {
    const doc = await transaction.get(db.doc(`chartOfAccounts/${account.id}`));
    if (!doc.exists || doc.get("organizationId") !== organizationId || doc.get("active") !== true || doc.get("currency") !== "NGN" || doc.get("code") !== account.code || doc.get("name") !== account.name || doc.get("billingControlPurpose") !== purpose || !/^2\d{3}$/.test(account.code)) return fail();
  }
  return config;
}
export function billingAccountSnapshot(doc: FirebaseFirestore.DocumentSnapshot): BillingAccount { return { id: doc.id, code: String(doc.get("code")), name: String(doc.get("name")) }; }

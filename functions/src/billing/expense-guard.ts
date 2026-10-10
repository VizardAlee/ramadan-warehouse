import { HttpsError } from "firebase-functions/v2/https";
import { db } from "../admin.js";
import type { MixedBilling } from "./allocations.js";
/** Read the case/invoice in the same transaction as approval, so an invoice link
 * and a draft expense cannot both establish the same provider obligation. */
export async function assertIndependentProviderExpense(tx: FirebaseFirestore.Transaction, organizationId: string, values: { costReferenceType?: string; costReferenceId?: string; supplierId?: string; supplierDocumentNumber?: string; independentObligationReference?: string }) {
  if (!values.costReferenceId) return;
  const linked = await tx.get(db.doc(`${values.costReferenceType === "aftersales" ? "aftersalesCases" : "sales"}/${values.costReferenceId}`));
  if (!linked.exists || linked.get("organizationId") !== organizationId) throw new HttpsError("not-found", "The linked cost record is unavailable.");
  const invoice = values.costReferenceType === "aftersales" ? linked.get("billingSaleId") ? await tx.get(db.doc(`sales/${linked.get("billingSaleId")}`)) : null : linked;
  if (invoice && (!invoice.exists || invoice.get("organizationId") !== organizationId)) throw new HttpsError("failed-precondition", "The linked billing record requires reconciliation.");
  const providers = (invoice?.get("billing") as MixedBilling | undefined)?.components.filter(c => c.kind === "provider" && c.grossMinor > c.creditedGrossMinor) ?? [];
  if (providers.some(c => !values.supplierId || c.supplierId === values.supplierId) && (!values.supplierDocumentNumber || !values.independentObligationReference || values.independentObligationReference.trim().length < 5)) throw new HttpsError("failed-precondition", "This provider obligation is already recorded as pass-through funds. Use Provider funds to settle it. A separate company expense requires its own supplier document and an explicit distinct-obligation reference.");
}

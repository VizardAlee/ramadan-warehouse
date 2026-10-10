import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../admin.js";
import { remainingCharge, serviceBalanceDelta, serviceBalances, type MixedBilling } from "./allocations.js";
import { readBillingMapping } from "./mappings.js";
export async function prepareBillingTransition(tx: FirebaseFirestore.Transaction, sale: FirebaseFirestore.DocumentSnapshot, after: MixedBilling) {
  const before = sale.get("billing") as MixedBilling;
  await readBillingMapping(tx, String(sale.get("organizationId")), before.mapping);
  if (JSON.stringify(before.mapping) !== JSON.stringify(after.mapping)) throw new HttpsError("failed-precondition", "A receipt must retain the invoice's original control mappings.");
  const cases: Array<{ ref: FirebaseFirestore.DocumentReference; values: Record<string, unknown> }> = [];
  for (const component of after.components) {
    if (!component.aftersalesCaseId) continue;
    const doc = await tx.get(db.doc(`aftersalesCases/${component.aftersalesCaseId}`));
    if (!doc.exists || doc.get("organizationId") !== sale.get("organizationId") || doc.get("branchId") !== sale.get("branchId") || doc.get("billingSaleId") !== sale.id || doc.get("billingSaleItemId") !== component.id) throw new HttpsError("failed-precondition", "The linked service case and invoice require reconciliation.");
    const balances = serviceBalances({ ...after, paidMinor: component.paidMinor, epochReceivedMinor: 0, components: [{ ...component, epochBaseMinor: component.paidMinor, epochWeightMinor: remainingCharge(component) - component.paidMinor }] });
    const gross = remainingCharge(component);
    cases.push({ ref: doc.ref, values: { amountPaidMinor: component.paidMinor, recognizedVatMinor: balances.vat, outstandingAmountMinor: gross - component.paidMinor, billedCreditedMinor: component.creditedGrossMinor, chargeStatus: gross === 0 ? "complimentary" : component.paidMinor === gross ? "paid" : component.paidMinor ? "partially_paid" : "due" } });
  }
  return { after, cases, lines: serviceBalanceDelta(before, after) };
}
export function writeBillingTransition(tx: FirebaseFirestore.Transaction, sale: FirebaseFirestore.DocumentReference, prepared: Awaited<ReturnType<typeof prepareBillingTransition>>, userId: string) {
  tx.update(sale, { billing: prepared.after, billingUpdatedAt: FieldValue.serverTimestamp() });
  prepared.cases.forEach(item => tx.update(item.ref, { ...item.values, updatedAt: FieldValue.serverTimestamp(), updatedBy: userId }));
}

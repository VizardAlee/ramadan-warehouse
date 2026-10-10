import { HttpsError } from "firebase-functions/v2/https";
import type { z } from "zod";
import { db } from "../admin.js";
import type { commitSaleInput } from "../validation/sales.js";
import { serviceReceiptVat } from "../services/billing.js";
import { readBillingMapping } from "./mappings.js";
const fail = (message: string): never => { throw new HttpsError("failed-precondition", message); };
export async function readMixedSaleContext(tx: FirebaseFirestore.Transaction, organizationId: string, input: z.infer<typeof commitSaleInput>, products: FirebaseFirestore.DocumentSnapshot[]) {
  const hasServices = products.some(product => product.get("itemKind") === "service");
  const cases = new Map<number, FirebaseFirestore.DocumentSnapshot>(), providers = new Map<number, FirebaseFirestore.DocumentSnapshot>();
  const mapping = hasServices ? await readBillingMapping(tx, organizationId) : null;
  for (const [index, line] of input.lines.entries()) {
    const service = products[index]!.get("itemKind") === "service";
    if (line.itemKind && line.itemKind !== (service ? "service" : "goods")) fail("The product kind changed. Refresh the catalogue.");
    if (service && (line.itemKind !== "service" || input.offline || input.calculationVersion !== 2 || line.serialNumbers?.length)) fail("Services require current online mixed-billing confirmation and never have physical serials.");
    if (!service && (line.includedParts || line.providerFunds || line.aftersalesCaseId)) fail("Only a service fee can have included parts, provider funds or a linked case.");
    if (line.providerFunds) {
      const provider = await tx.get(db.doc(`suppliers/${line.providerFunds.supplierId}`));
      if (!provider.exists || provider.get("organizationId") !== organizationId || provider.get("active") !== true) fail("Select an active existing supplier for provider funds.");
      providers.set(index, provider);
    }
    if (line.aftersalesCaseId) {
      const doc = await tx.get(db.doc(`aftersalesCases/${line.aftersalesCaseId}`));
      if (!doc.exists || doc.get("organizationId") !== organizationId || doc.get("branchId") !== input.branchId || doc.get("serviceCatalog.itemId") !== line.productId || ["cancelled", "rejected"].includes(doc.get("status")) || (doc.get("customerId") && doc.get("customerId") !== input.customerId)) fail("The linked case must belong to this store, service and customer.");
      if (doc.get("billingSaleId")) fail("This case is already owned by an invoice. Use that invoice for receipts and credits.");
      if (doc.get("serviceBillingVersion") !== 2 || !["due", "partially_paid", "paid"].includes(doc.get("chargeStatus")) || line.quantity !== 1 || line.sellingPriceMinor !== undefined || line.priceTier === "wholesale") fail("Only a compatible confirmed catalogue charge can be linked. Historical cases require reconciliation; no charge was reinterpreted.");
      const gross = doc.get("chargeAmountMinor"), vat = doc.get("chargeVatMinor"), paid = doc.get("amountPaidMinor") ?? 0;
      if (![gross, vat, paid].every(value => typeof value === "number" && Number.isSafeInteger(value) && value >= 0) || gross <= 0 || vat > gross || paid > gross || doc.get("outstandingAmountMinor") !== gross - paid || (doc.get("recognizedVatMinor") ?? 0) !== serviceReceiptVat(0, paid, gross, vat)) fail("The original case charge, payments and tax require reconciliation before linking.");
      if (line.providerFunds) {
        const expenses = await tx.get(db.collection("expenses").where("costReferenceId", "==", doc.id));
        if (expenses.docs.some(expense => expense.get("organizationId") === organizationId && ["approved", "partially_paid", "paid"].includes(expense.get("status")) && ["service", "logistics"].includes(expense.get("costPurpose")))) fail("A company expense already covers this linked obligation. Reconcile it before adding provider pass-through funds.");
      }
      cases.set(index, doc);
    }
  }
  if (new Set([...cases.values()].map(doc => doc.id)).size !== cases.size) fail("A service case can appear only once on an invoice.");
  return { mapping, cases, providers, priorPaidMinor: [...cases.values()].reduce((sum, doc) => sum + Number(doc.get("amountPaidMinor") ?? 0), 0) };
}

/** Pure, non-posting preflight for historical purchase reclassification.
 * This module deliberately has no database imports or callable export. A valid
 * plan is NOT authorization to execute it. Original stock receipts stay intact.
 */
export interface ReclassificationLine {
  id: string; productId: string; trackingType: string; quantity: number; unitCostMinor: number;
  receivedQuantity: number; invoicedQuantity: number; vatMinor: number;
  receiptId: string; inventoryTransactionId: string;
  disposition: "external" | "internal";
  externalSupplierId?: string;
  source?: { locationId: string; balanceVersion: number; availableQuantity: number;
    unitCostMinor: number; managementUnitCostMinor: number; alreadyIssued: boolean };
}
export interface ReclassificationInvoice {
  id: string; purchaseOrderId: string; purchaseOrderNumber: string;
  organizationId: string; destinationLocationId: string; supplierId: string;
  status: string; netMinor: number; vatMinor: number; grossMinor: number;
  paidMinor: number; creditedMinor: number; outstandingMinor: number;
  journalId: string; journalPosted: boolean; journalReversed: boolean;
  periodOpen: boolean; correctionId?: string; lines: ReclassificationLine[];
}
export interface ReclassificationEvidence {
  organizationId: string;
  invoices: ReclassificationInvoice[];
  transportMinor: number | null;
  currentPeriodOpen: boolean;
  sourceLocationConfirmed: boolean;
  sourceNotPreviouslyIssuedConfirmed: boolean;
  hasDependentReturnsOrCredits: boolean;
}
export interface ReclassificationPlan {
  version: 1;
  executable: false;
  invoiceIds: string[];
  blockers: string[];
  externalPurchaseMinor: number;
  internalTransferMinor: number;
  originalPayableMinor: number;
  destinationQuantityDelta: 0;
  destinationValueDeltaMinor: 0;
  sourceIssues: { productId: string; locationId: string; quantity: number; expectedBalanceVersion: number }[];
  originalJournalReversals: string[];
  replacementExternalInvoices: { originalInvoiceId: string; supplierId: string; lineIds: string[]; netMinor: number }[];
}
const MAX = 100_000_000_000_000;
function safe(value: number, name: string, positive = false) {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0) || value > MAX) throw new Error(`Invalid ${name}.`);
  return value;
}
function add(a: number, b: number) { return safe(a + b, "total"); }
function identifier(value: string) { if (!value || value.includes("/") || value.length > 128) throw new Error("Invalid document identity."); }
/** Fail closed for VAT, transport, partial receipts, existing issue evidence,
 * valuation differences and dependent documents. Those need separate reviewed
 * treatments, not guesses or silent stock/accounting changes.
 */
export function planPurchaseReclassification(evidence: ReclassificationEvidence): ReclassificationPlan {
  identifier(evidence.organizationId);
  if (evidence.invoices.length !== 3) throw new Error("This bounded repair requires exactly three reviewed purchase invoices.");
  const orderNumbers = new Set<string>();
  const blockers = new Set<string>();
  const invoiceIds = new Set<string>(), orderIds = new Set<string>(), lineIds = new Set<string>(), receiptIds = new Set<string>(), movementIds = new Set<string>(), productIds = new Set<string>(), journalIds = new Set<string>();
  const plan: ReclassificationPlan = { version: 1, executable: false, invoiceIds: [], blockers: [], externalPurchaseMinor: 0, internalTransferMinor: 0,
    originalPayableMinor: 0, destinationQuantityDelta: 0, destinationValueDeltaMinor: 0, sourceIssues: [], originalJournalReversals: [], replacementExternalInvoices: [] };
  if (!evidence.currentPeriodOpen) blockers.add("Current accounting period is closed.");
  if (evidence.transportMinor === null) blockers.add("Transportation cost has not been confirmed.");
  else if (safe(evidence.transportMinor, "transport") !== 0) blockers.add("Nonzero transport requires a separately reviewed capitalization plan.");
  if (!evidence.sourceLocationConfirmed) blockers.add("Head Office source location has not been confirmed.");
  if (!evidence.sourceNotPreviouslyIssuedConfirmed) blockers.add("Original source-issue history has not been reconciled.");
  if (evidence.hasDependentReturnsOrCredits) blockers.add("Dependent returns or credit records require reconciliation.");
  const destination = evidence.invoices[0]!.destinationLocationId;
  let internalLines = 0, externalLines = 0;
  for (const invoice of evidence.invoices) {
    for (const id of [invoice.id, invoice.purchaseOrderId, invoice.supplierId, invoice.destinationLocationId, invoice.journalId]) identifier(id);
    if (invoice.organizationId !== evidence.organizationId || invoice.destinationLocationId !== destination) throw new Error("Invoices must belong to the same organization and receiving location.");
    if (orderNumbers.has(invoice.purchaseOrderNumber) || invoiceIds.has(invoice.id) || orderIds.has(invoice.purchaseOrderId) || journalIds.has(invoice.journalId)) throw new Error("Unexpected or duplicate purchase invoice.");
    identifier(invoice.purchaseOrderNumber); orderNumbers.add(invoice.purchaseOrderNumber); invoiceIds.add(invoice.id); orderIds.add(invoice.purchaseOrderId); journalIds.add(invoice.journalId);
    if (invoice.lines.length < 1 || invoice.lines.length > 6) throw new Error("Invalid invoice line count.");
    if (invoice.status !== "approved" || invoice.correctionId) blockers.add(`${invoice.purchaseOrderNumber}: invoice is not an uncorrected approved invoice.`);
    if (safe(invoice.paidMinor, "paid") || safe(invoice.creditedMinor, "credited")) blockers.add(`${invoice.purchaseOrderNumber}: payment or credit already exists.`);
    if (!invoice.periodOpen) blockers.add(`${invoice.purchaseOrderNumber}: original accounting period is closed.`);
    if (!invoice.journalPosted || invoice.journalReversed) blockers.add(`${invoice.purchaseOrderNumber}: original journal requires reconciliation.`);
    if (safe(invoice.outstandingMinor, "outstanding") !== safe(invoice.grossMinor, "gross")) blockers.add(`${invoice.purchaseOrderNumber}: outstanding amount differs from gross.`);
    if (add(safe(invoice.netMinor, "net"), safe(invoice.vatMinor, "VAT")) !== invoice.grossMinor) throw new Error("Invoice totals are inconsistent.");
    if (invoice.vatMinor) blockers.add("VAT requires a separately reviewed tax correction.");
    let net = 0, vat = 0;
    const replacements = new Map<string, { originalInvoiceId: string; supplierId: string; lineIds: string[]; netMinor: number }>();
    for (const line of invoice.lines) {
      for (const id of [line.id, line.productId, line.receiptId, line.inventoryTransactionId]) identifier(id);
      if (lineIds.has(line.id) || productIds.has(line.productId) || receiptIds.has(line.receiptId) || movementIds.has(line.inventoryTransactionId)) throw new Error("Duplicate line, product or receipt provenance.");
      lineIds.add(line.id); productIds.add(line.productId); receiptIds.add(line.receiptId); movementIds.add(line.inventoryTransactionId);
      if (line.trackingType !== "quantity") blockers.add(`${line.id}: only ordinary quantity-tracked stock is supported.`);
      safe(line.quantity, "quantity", true); safe(line.unitCostMinor, "unit cost", true);
      const amount = safe(line.quantity * line.unitCostMinor, "line net", true);
      net = add(net, amount); vat = add(vat, safe(line.vatMinor, "line VAT"));
      if (safe(line.receivedQuantity, "received quantity") !== line.quantity || safe(line.invoicedQuantity, "invoiced quantity") !== line.quantity) blockers.add(`${line.id}: receipt/invoice quantity mismatch.`);
      if (line.disposition === "external") {
        if (line.source) throw new Error("External lines cannot issue Head Office stock.");
        externalLines += 1; plan.externalPurchaseMinor = add(plan.externalPurchaseMinor, amount);
        if (!line.externalSupplierId) blockers.add(`${line.id}: actual external supplier has not been confirmed.`);
        else {
          identifier(line.externalSupplierId);
          if (line.externalSupplierId === invoice.supplierId) blockers.add(`${line.id}: external supplier still points to the original Head Office supplier.`);
          const replacement = replacements.get(line.externalSupplierId) ?? {originalInvoiceId: invoice.id, supplierId: line.externalSupplierId, lineIds: [], netMinor: 0};
          replacement.lineIds.push(line.id); replacement.netMinor = add(replacement.netMinor, amount); replacements.set(line.externalSupplierId, replacement);
        }
      } else if (line.disposition === "internal") {
        if (line.externalSupplierId) throw new Error("Internal lines cannot create an external payable.");
        internalLines += 1; plan.internalTransferMinor = add(plan.internalTransferMinor, amount);
        if (!line.source) blockers.add(`${line.id}: source inventory evidence is missing.`);
        else {
          identifier(line.source.locationId);
          if (line.source.locationId === destination) throw new Error("Source cannot equal destination.");
          safe(line.source.balanceVersion, "balance version"); safe(line.source.availableQuantity, "available quantity"); safe(line.source.unitCostMinor, "source cost"); safe(line.source.managementUnitCostMinor, "source management cost");
          if (line.source.alreadyIssued) blockers.add(`${line.id}: source issue already exists; do not deduct again.`);
          if (line.source.availableQuantity < line.quantity) blockers.add(`${line.id}: insufficient unreserved source stock.`);
          if (line.source.unitCostMinor !== line.unitCostMinor || line.source.managementUnitCostMinor !== line.unitCostMinor) blockers.add(`${line.id}: source valuation differs; reconcile company and management costs first.`);
          plan.sourceIssues.push({ productId: line.productId, locationId: line.source.locationId, quantity: line.quantity, expectedBalanceVersion: line.source.balanceVersion });
        }
      } else throw new Error("Unknown line disposition.");
    }
    if (net !== invoice.netMinor || vat !== invoice.vatMinor) throw new Error("Invoice lines do not reconcile to totals.");
    plan.replacementExternalInvoices.push(...replacements.values());
    plan.originalPayableMinor = add(plan.originalPayableMinor, invoice.grossMinor);
    plan.invoiceIds.push(invoice.id); plan.originalJournalReversals.push(invoice.journalId);
  }
  // Scope stays deliberately small; actual identities/quantities/costs are
  // bound to server-verified source records and a reviewed evidence fingerprint.
  if (lineIds.size !== 6 || internalLines !== 4 || externalLines !== 2 ||
      add(plan.externalPurchaseMinor, plan.internalTransferMinor) !== plan.originalPayableMinor)
    throw new Error("Use exactly six lines: four internal supply and two external purchases, with matching totals.");
  plan.blockers = [...blockers];
  return plan;
}

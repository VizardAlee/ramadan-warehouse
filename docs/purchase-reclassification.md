# Historical purchase reclassification

## Capability and authorization

The existing `approveSupplierInvoice` callable provides commands
`preview_reclassification` and `execute_reclassification` for a bounded mixed
purchase correction. It requires a directly assigned system administrator and
existing finance reversal, procurement and inventory authority. No new roles,
IAM grants or client write permissions are added.

This capability is not an instruction to change business records. Actual external
suppliers, physical source location, freight and original source movements must
be established and the preview reviewed before any execution. There is no new
UI button. Original PO rows remain historical received records; correction and
replacement links are retained in audit records.

The pure planner returns `executable: false`: planning alone neither posts nor
authorizes writes. Execution is a separate command bound to a server-generated
evidence fingerprint, explicit reason and UUID idempotency key.

## Bounded supported case

- Exactly three approved, unpaid, uncredited invoices covering six distinct
  ordinary quantity-tracked products: four internal supply and two external.
- All original orders fully received and invoiced; one receipt per line; one
  invoice per order; same organization, branch and destination location.
- Confirmed actual external suppliers distinct from the original supplier.
- One configured Head Office source location with a reconciled positive ledger,
  sufficient unreserved stock and no prior outgoing history for these products.
- No subsequent destination movement since the original receipts.
- Exact source company and management issue values equal to existing destination
  values. Explicitly confirmed zero freight, zero VAT and open accounting periods.
- No dependent payments, returns, credits, prior corrections or changed evidence.

These conservative limits may block a real historical batch. Do not bypass them;
other cases require a separately reviewed valuation/provenance treatment.

## Atomic accounting and inventory treatment

All evidence is loaded server-side and rechecked in one Firestore transaction.
Client confirmations do not replace record validation. The correction identity
is derived from the organization and selected original invoices; individual
invoice and receipt markers prevent overlap under another retry reference.

The transaction preserves original amounts and receipt identities, voids the
original invoices with zero outstanding, posts compensating invoice journals and
supplier account entries, and creates approved external replacement invoices for
actual suppliers. Original PO received/invoiced counters remain consumed.
Replacement invoice numbers use ordinary uniqueness reservations.

Destination stock is never received again or changed. Verified source quantities
and values are deducted once. Balanced external stock counterentries neutralize
the wrong supplier provenance and assign actual external supply to its supplier.
Linked completed internal transfer/invoice/subledger evidence is created for
internal lines, without external revenue, external payable or invented payment.

Ordinary internal merchandise transfers do not add a GL journal in this app.
The correction reverses the erroneous purchase GL; it does not additionally
credit source inventory GL. This matches existing consolidated accounting.

All stock, invoices, journals, balances, audit and idempotency records commit
atomically. Exact retries return the saved result; changed or overlapping requests
fail. Late uniqueness conflicts roll back every pending mutation.

## Downstream limits

Corrected internal transfer evidence is immutable. Goods returns against corrected
external invoices or internal trades require separately reviewed original-receipt
support. Ordinary payment processing remains available for replacement payables;
no payment is manufactured by reclassification.

Current payables and aging exclude void original invoices. Historical PO screens
still retain original supplier/gross values; they do not yet show a dedicated
reclassification badge. Use linked correction/audit evidence for interpretation.

## Release verification

Use isolated demo emulators for all mutation tests. Test authorization, concurrent
exact replay, changed evidence, source shortages, cross-organization data, closed
periods, serial stock, existing payments, duplicate correction and late uniqueness
failure. Assert unchanged destination quantities/value, balanced journals and
stock counterentries, correct supplier/internal balances and preserved counters.

Run lint, typechecks, unit suite, procurement and internal-trade regressions.
Query-bearing changes must pass the live planner-only index audit and refreshed
baseline validation. Live index probes must use analyze=false and sentinel scopes,
not business mutations. Deploy only the affected existing callables after checks
pass; verify deployed revisions separately from actual business-data correction.

All examples and test fixtures added for this feature are fictional. No business
purchase identifiers, product names or prices are embedded in the implementation.

# Collection waybills

Open a posted sale document and choose **View waybill** beside a physical
handover. Print the branded A4 document or save it as PDF. Shared print styles
remove dialog height/scroll restrictions so long documents are not cropped.

Each partial handover has a separate immutable `saleCollections` record. Its
waybill uses only that record's quantities, collector, time and releasing staff,
with SKU/unit information from the original sale items. Prices/payment totals
are deliberately excluded. The stable `WB-INV-…` reference comes from the linked
stock movement; if legacy movement metadata is unavailable, the unique
collection ID is used instead. Reprints perform no inventory/accounting writes.

New immediate checkout releases also create a handover record in the **same
transaction**, referencing the existing stock movement and journal. This is
evidence only: no second stock deduction or COGS journal. Existing idempotency
prevents duplicate collections on replay. Where the checkout flow did not
capture the collector's name, the document explicitly says so rather than
assuming that the paying customer collected the goods. Later partial
collections still require the collector through the existing collection form.

Invoice issuance/reservation without physical release creates no printable
waybill. Provisional offline invoices cannot issue one. Historical sales are
not backfilled with invented handover dates or collectors; older immediate
sales without collection evidence remain invoice/receipt-only.

The existing sale-document query returns the latest 25 collections; paging
older collection documents is still pending. POS remains quantity-tracked:
serial-number checkout/evidence is a separate unfinished workstream, not
implied by this printable document.

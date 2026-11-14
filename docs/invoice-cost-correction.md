# Submitted supplier-invoice cost correction

Use Accounts Payable → submitted invoice → Correct received cost before approval.
Select the product, enter the corrected cost and reason, review the calculated
invoice total, and save. Reopen and review before normal invoice approval.

This bounded correction changes neither physical quantities nor payments. It
preserves original stock ledger entries and the original cost in receipt/item
evidence, creates balanced zero-quantity valuation entries, and records an audit
with before/after values. The pending invoice recognizes the corrected Inventory
and Accounts Payable values only when approved; no fictitious GRNI journal is
created because ordinary purchase receiving is stock-only in this application.

Supported: one complete quantity-tracked receipt per item, one submitted unpaid
invoice covering the full received order, with no later movement at that stock
position. Existing procurement-create/receive and payables-approve grants and
location scope are required. Self-authorization restrictions remain unchanged.

Blocked: already posted/paid or split invoices, batch/serial goods, further changes
to the same corrected receipt, closed periods, stale amounts, and any stock
movement since receiving. For intervening sales/transfers, reconcile their COGS
and destination valuation separately; never blindly reduce current inventory or
simulate a goods return. No UI bypass or direct data editing is provided.

Interrupted requests retain the exact instructions and idempotency key in browser
session storage. Retry the saved correction. Approval is disabled while editing
or a correction is pending; server-side approval also checks the reviewed total.

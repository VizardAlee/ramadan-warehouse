# Customer account arrangements

This extends the existing customer, POS, receivable, journal and audit systems.
It does not create duplicate customer identities or separate credit limits.

## Using arrangements

- In Customers, edit a customer and add or edit an account arrangement, with a reason. Up to 20 named arrangements are supported.
- In POS, select the customer and their active arrangement before receiving the order. The sale retains that selection through payment confirmation.
- In Record payment, choose the receiving company account as required and allocate the receipt to one or more arrangements. Allocations must equal the amount received; an arrangement cannot repay another arrangement's debt.
- Full customer history shows arrangement balances and allocation details alongside paginated sales, returns and account entries.
- In full history, choose Account statement and optionally an arrangement. The statement uses account entries once (not both the sale and its credit entry), separates debt from advances, and supports page export. Current balances cover all stores; store selection filters entries only. A sparse page can have no matches: Next continues the bounded scan. Inactive arrangements remain readable. Unknown historical classifications are flagged for review, not guessed.
- Return credits reduce the original sale's arrangement and, for tracked invoices, its unpaid projection. Renaming an arrangement does not rewrite historical labels. An arrangement with outstanding debt or an unused advance cannot be deactivated; arrangements are not deleted.

## Historical data and integrity

Existing customer outstanding balance remains the consolidated authority.
General is the residual after named balances are deducted. Existing debt is
therefore retained in General without inferring or rewriting old transactions.
All arrangements share the existing customer-wide credit limit and authorization.

Trusted transactions update arrangement balances, consolidated balance, receipts,
balanced journals and audit evidence together. Receipt retries retain their
idempotency reference while the payment dialog remains open. After an uncertain
result, payment details are locked for retry. If the dialog or page is closed,
check customer history before recording the payment again.

Held and offline payloads retain the selected arrangement ID. Credit sales still
require a connection. Unknown or deactivated arrangements are rejected by the
server rather than silently reassigned. Direct client balance writes remain denied.

## Invoice repayment, advances and aging

New credit sales retain an optional agreed due date (including split-tender credit).
Their original issued amounts remain immutable. Separate invoice projections track
later repayments, credited returns and current unpaid balance.

Full customer history shows paginated unpaid invoices, server-aggregated aging
(current, 1–30, 31–60, 61–90, over 90 days and undated), and unused advances.
Record payment can select one invoice for full or partial repayment. The trusted
API supports up to 50 unique invoice allocations per receipt. Without explicit
selection, receipts clear historical unallocated debt first, then the oldest
tracked invoices in the receiving store and selected arrangements, up to 50.
For other stores or larger batches, select invoices explicitly or split receipts.

Record advance receives money into the selected company account and credits the
customer-advance liability (2210), not sales income or accrued expenses (2300).
To apply it, open Payment, choose Apply previously received advance and select
the invoice/arrangement. This debits 2210 and credits receivables (1100), without
another cash receipt. Insufficient advances and overpaid invoices are rejected.
Customer-wide credit authorization still applies when receiving a credit order.
POS also supports full payment from an unused advance, or one advance component
alongside cash, card, transfer and authorized credit. Select the named customer
and arrangement. A live balance check is required: advances cannot be queued
offline. Holding, receiving, accepting or rejecting an order does not spend the
advance. Final confirmation atomically consumes it and links the sale, payment,
journal and account entry. It is not another cash/bank receipt. Competing sales,
debt applications and refunds cannot spend the same balance twice.

Use Refund unused advance for money owed back to the customer, with a reason
and the paying company account/reference for non-cash refunds. Refunds debit
2210 and credit the money account; they do not change invoice debt or inventory.
Returns from advance-funded sales follow the normal authorized refund/exchange
workflow and do not also replenish the advance balance.

The existing scheduled notification worker scans due invoices in resumable
25-record pages per organization. Due-today alerts are deduplicated per date;
overdue reminders per seven-day epoch window. Eligible active payment staff in
the responsible store (or organization administrators) receive the existing
bell/push notification linking to customer history. Settled invoices supersede
undelivered alerts. Undated/historical debt gets no invented overdue date.
This requires the existing scheduled-functions feature flag and delivery worker.

No historical sale/payment is backfilled or reassigned. Legacy debt remains
explicitly unallocated; historical migration requires verified evidence and a
separate reconciliation plan. Arrangement-filtered credit/advance statements
are available. Dated opening/closing reconciliation and verified historical
corrections remain roadmap work; current balances must not be mistaken for
opening/closing balances or netted with advances.

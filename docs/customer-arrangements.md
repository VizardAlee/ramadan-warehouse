# Customer account arrangements

This extends the existing customer, POS, receivable, journal and audit systems.
It does not create duplicate customer identities or separate credit limits.

## Using arrangements

- In Customers, edit a customer and add or edit an account arrangement, with a reason. Up to 20 named arrangements are supported.
- In POS, select the customer and their active arrangement before receiving the order. The sale retains that selection through payment confirmation.
- In Record payment, choose the receiving company account as required and allocate the receipt to one or more arrangements. Allocations must equal the amount received; an arrangement cannot repay another arrangement's debt.
- Full customer history shows arrangement balances and allocation details alongside paginated sales, returns and account entries.
- Return credits reduce the original sale's arrangement. Renaming an arrangement does not rewrite historical labels. An arrangement with outstanding debt cannot be deactivated; arrangements are not deleted.

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

## Remaining work

Invoice-level payment allocation/settlement, advance wallets, arrangement-filtered
statements, debt aging/reminders and historical correction workflows remain
separate roadmap items. Arrangement allocation alone does not settle individual
invoice balances.

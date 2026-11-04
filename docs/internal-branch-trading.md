# Head-office and branch trading

## Two supply routes

New transfers from the administrator-designated Head Office, or its configured
supply warehouse, to another branch use an internal trading agreement. Other
store-to-store movements retain their existing inventory-only behavior. An
administrator must set each internal unit price before the source confirms the
stock. Prices and the HQ counterpart are snapshotted and cannot change after
approval. Changing HQ setup affects future requests, not existing agreements.

An independent branch purchase continues through **Procurement** with the
existing purchase-order, receiving, supplier-invoice and payment permissions.
It creates a supplier balance, never a head-office balance. This feature does
not assign procurement, financial or banking privileges to staff.

## Receipt and credit

The existing stock-receipt transaction remains the only stock movement. Each
partial receipt adds only newly confirmed good quantities to the internal
invoice, records immutable receipt evidence and updates the branch/HQ balance
in that same transaction. An invoice is a cumulative operational projection;
its underlying receipt, payment, damage-review and return entries are retained.
No invoice or debt exists merely because stock was requested or held.

Damaged arrivals go to the existing damaged-stock area. Their financial charge
is held until an authorized administrator explicitly reviews the quantity and
chooses whether to charge it. The decision and reason are recorded. Financial
review never makes damaged stock saleable or moves it out of quarantine.
Missing, cancelled and lost quantities are not invoiced as good receipts.

Old transfers, including old transfers still awaiting receipt at rollout,
remain inventory-only. No historical transfers, opening balances, users or
prices are migrated or inferred.

## Payment and return records

**Move stock → Head-office accounts** shows internal invoices, full persisted
balances and invoice entries. A branch can leave an invoice on credit. Staff
with existing organization-wide `banking.transfer` authority may record a
completed payment immediately or later. Recording a payment does not send
money, call a bank, or schedule a transfer.

Cash or bank movements use two balanced store journals through interbranch
funds clearing. An existing completed company transfer can instead be allocated
using its original journal ID and exact date/time, without posting money again.
Allocation and invoice limits prevent applying the same recorded funds twice.
Bank fees remain separately recorded expenses. The outstanding amount may
become a branch credit after already-paid goods are returned; no automatic
refund, transfer or cross-invoice credit application is inferred.

A directly assigned authorized administrator can confirm a received return of
original good, resellable stock to its original source. Stock movement and
credit at the original internal price commit together. Quantity, serial/lot,
availability and original-invoice limits apply. Damaged stock is not restored
to saleable inventory through this action. Generic stock-only reversal cannot
undo a linked invoice or credit.

## Cost, reporting and access

Internal prices never replace company acquisition costs, serial costs or
inventory ledger values. Transfer and return movements conserve company value,
including final-unit rounding. Internal invoices and balances are stored in a
dedicated callable-only subledger, not external customer sales, supplier
payables, VAT records or company revenue. Paired internal funds movements net
out in consolidated cash-flow and receipts/payment reports while retaining the
actual bank/cash movements in each store.

The accounts page reports internal purchasing, payment, return and outstanding
amounts. Existing product profitability continues to use company-cost sale
evidence. It is not branch gross margin at internal transfer prices, and invoice
purchases must not be subtracted from current sales and labeled gross profit.

Financial reads retain existing own-location/global financial permission
provenance. Transfer-only users may receive stock without seeing restricted
prices or balances. Pricing and damage review use existing administrator cost
authority; returns and payments retain their own action permissions. No new
role grants, Firestore client rules, IAM configuration or credentials are
required. Financial-display masking remains a presentation preference, not
access control.

## Recovery and verification

Mutation instructions are saved before submission. An interrupted result locks
further actions until **Retry saved action** confirms the exact original
payload and retry key. Return to the original working location before retrying.
Do not invent another delivery or payment reference to resolve an uncertain
result. Server transactions retain actor, payload, version, scope and period
checks. When a replay key is absent and a later version proves the saved
version-bound instruction cannot commit, the server explicitly confirms it was
not recorded and allows correction. Permission changes and ambiguous failures
never clear an uncertain saved instruction.

New charges, payments and return credits respect accounting-period locks.
Damaged-only receipt into quarantine and an explicit no-charge damage decision
can record physical/review evidence without adding a charge in a closed period.

Focused unit/transaction-fixture coverage is in `internal-trade-*.test.ts`,
`internal-trading-ui.test.tsx`, `internal-transfer-valuation.test.ts` and
`stock-transfer-action-recovery.test.tsx`. The isolated Auth/Firestore/Functions
integration suite is `npm run test:internal-trading`; it is also included in
the normal callable and production gates. New query shapes and changed query
sources require the existing read-only live query audit before its baseline is
updated. Deployment and live acceptance are separate from source/test success.

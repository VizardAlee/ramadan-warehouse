# Branch POS and sales architecture

## Product decisions

Every POS sale belongs to exactly one active branch and issues stock only from
that branch's active sales-stock location. The central warehouse establishes
the product's base selling price. A branch may publish a higher price; a price
below the base price requires an explicit system-administrator approval
workflow. Prices and all other money values are stored as integer NGN minor
units. VAT is calculated and displayed separately using an organization-
configurable rate stored in basis points.

Only active customers approved by a system administrator may use credit.
Credit sales, returns, refunds, exchange-credit redemption, below-base price
changes, and other actions that depend on current balances or approval remain
online-only.

## Phase 1 boundary — complete

Phase 1 provides branch-scoped POS access, centrally managed base prices,
branch markups, paid quantity-tracked sales, payment-method records, immutable
receipts, inventory/COGS posting, balanced sales journals, and durable offline
sale capture and retry. Cash, card, bank transfer, and split payments are
recorded; external payment-provider settlement is not inferred.

## Phase 2 boundary — customer credit and receivables

Phase 2 adds organization customer records, administrator-only credit approval,
live available-credit validation, fully paid or split credit checkout support,
an immutable customer account ledger, and online customer repayment posting.
A customer begins with `pending` credit authority. Only a system administrator
may approve a positive limit, suspend further use, reject an application, or
change the limit. Existing outstanding debt is never erased by suspension.

Credit is not a payment method in the accounting model. At checkout the amount
granted on credit debits Accounts Receivable (`1100`), while any cash, card, or
bank portion debits its settlement account. The full sale still credits sales
revenue and VAT payable and posts stock/COGS atomically. A repayment later
debits the receiving settlement account and credits Accounts Receivable. It
adds `customerPayments`, `customerAccountEntries`, journal, and audit evidence;
it does not edit the sale or receipt.

Credit checkout, credit decisions, and repayments are online-only because the
server must validate the current customer status, outstanding balance, and
available limit in one transaction.

## Phase 3 boundary — controlled returns, refunds, and exchanges

A return begins by loading the original completed branch receipt. The return
reuses its product, quantity, sale price, VAT, and inventory cost snapshots.
The user selects only the quantity, physical condition, resolution, and reason.
Submission changes no stock or money. A different authorized user must approve
and post it; the creator cannot self-approve even when they hold another role.

The server transaction rechecks the remaining returnable quantity. A
restockable item increases the original branch sales-stock balance at original
cost and reverses COGS. A damaged/non-restockable item does not increase stock.
The sales and VAT correction is balanced against the selected refund clearing
account, Accounts Receivable, or an exchange-credit liability. Exchange credit
is branch-bound, balance checked online, and reduced atomically when used on a
new POS sale. A cash refund must reference an open branch till and reduces that
shift's expected closing cash. The original sale and receipt remain immutable.

```text
approved returned quantity <= sold quantity - previously approved returns
restockable return: branch stock + returned quantity
non-restockable return: branch stock unchanged
return debits = return credits
```

Serialized and batch checkout, procurement/accounts payable, expenses, bank reconciliation, period
closing, and complete financial statements follow in later phases. The schema
and journals introduced here are designed for those extensions.

## Atomic sale invariant

A server-confirmed sale is one Firestore transaction. It creates the sale,
items, payments, receipt identity, inventory transaction and entries, balanced
accounting journal and lines, audit record, and idempotency record while it
updates branch inventory balances. Any failed validation aborts all writes.

For each sale:

```text
payment total = net sales + VAT
debits = credits
inventory quantity/value and COGS use the branch balance at posting time
```

The minimum journal is:

```text
Debit  cash/card/bank clearing                 gross total
Credit sales revenue                           net total
Credit VAT payable                             VAT total
Debit  cost of goods sold                      inventory cost
Credit inventory asset                         inventory cost
```

Confirmed sales are never edited or deleted. Returns and refunds add linked
correcting records; reconciliation never rewrites the original sale.

## Pricing

`productSalesPrices/{productId}` stores the centrally controlled base price,
VAT rate, version, and audit metadata. `branchSalesPrices` stores an optional
branch override. The effective price is the active branch override when it is
at least the current base price, otherwise the base price. Clients submit only
product and quantity; online checkout resolves authoritative prices on the
server.

Offline drafts retain the trusted price/version snapshot received from the POS
workspace. Synchronization rejects a stale or invalid price rather than
silently changing a customer receipt. A manager may then refresh and resolve
the queued sale explicitly.

When the central base price changes, an older branch override is used only if
it remains at or above the new base price. A below-base administrator approval
is valid only for the exact central-price version it approved. Otherwise the
POS falls back to the new central price until the branch publishes a new
override. This prevents an old markup from silently becoming an unauthorized
discount.

## Offline contract

The installed browser stores the last trusted branch catalogue, cart drafts,
and queued paid sales in IndexedDB. A service worker keeps the POS application
shell available after it has been opened successfully online. Each queued sale
has a UUID idempotency key and a locally unique provisional receipt reference.
Reconnect retries are safe and never create duplicate sales.

Phase 1 consumes only the device's last trusted available quantity. A branch
manager may capture an over-allowance sale locally, but it remains visibly
blocked for stock reconciliation and cannot be represented as a server-posted
financial sale until inventory is resolved. Cash is confirmed locally; card
and bank-transfer payments remain awaiting verification until synchronization.

No authoritative Firestore client write is enabled. Server callables remain the
only path to confirmed sales, inventory balances, journals, or receipts.

## Access

- System administrators can see every branch and manage all prices and sales.
- Warehouse managers can establish central base prices.
- Branch managers can operate their assigned branch POS and publish markups.
- Sales cashiers can operate POS only for assigned branches.
- Branch managers and operations administrators may create customer records,
  but creation never approves credit.
- Only system administrators approve or change customer credit authority.
- Authorized branch managers and finance staff may record real customer
  repayments; all users remain scoped to their assigned authority.
- Sales cashiers and branch managers may submit branch receipt returns. Branch
  managers, operations administrators, finance officers, and system
  administrators may approve within scope, but never their own submission.
- Finance officers and auditors receive organization-scoped read/report access.

Operating-context selection narrows multi-role users to the selected branch or
warehouse. A branch-scoped user never chooses or submits an arbitrary branch.

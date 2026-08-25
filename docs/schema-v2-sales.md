# Sales and finance schema version 2

Schema version 2 is an additive sales and accounting extension to the frozen
warehouse schema v1. Existing inventory, request, and transfer records retain
their meaning.

| Classification | Collections |
|---|---|
| Sales configuration | `productSalesPrices`, `branchSalesPrices` |
| POS operation | `posShifts`, `posShiftLocks`, `salesCounters` |
| Customer master and credit authority | `customers`, `customerCounters` |
| Customer receivables evidence | `customerAccountEntries`, `customerPayments`, `customerPaymentCounters` |
| Immutable sale evidence | `sales`, `saleItems`, `salePayments`, `salesReceipts` |
| Return/refund evidence | `saleReturns`, `saleReturnItems`, `saleReturnItemCounters`, `saleRefunds` |
| Exchange value | `salesCredits` |
| Accounting | `chartOfAccounts`, `journalCounters`, `journalEntries`, `journalLines` |
| Supplier master | `suppliers`, `supplierCounters`, `supplierCodes` |
| Purchasing | `purchaseOrders`, `purchaseOrderItems`, `purchaseReceipts`, `purchaseOrderCounters` |
| Accounts Payable | `supplierInvoices`, `supplierInvoiceItems`, `purchaseInvoiceItemCounters`, `supplierPayments`, `supplierPaymentAllocations`, `supplierAccountEntries` |
| Operating expenses | `expenseCategories`, `expenseCategoryCounters`, `expenses`, `expenseCounters`, `expenseDocumentCodes`, `expensePayments` |
| Banking and reconciliation | `bankAccounts`, `bankStatementTransactions`, `bankReconciliations`, `bankReconciliationCounters` |
| Existing ledger integration | `inventoryTransactions` and `inventoryEntries` using `branch_sale`; `inventoryBalances` remains the mutable projection |
| Reliability/control | existing `idempotencyKeys`, `auditLogs`, plus browser-local queued drafts that are not authoritative records |

Every confirmed sale is created in one Firestore transaction with its receipt,
payment, paired inventory entries, balance update, COGS, journal, audit record,
and idempotency record. Confirmed records are append-only. Later returns and
refunds add linked correcting records rather than editing the original.

`saleReturnItemCounters` is the transactional projection that prevents all
approved returns for one sale item from exceeding its sold quantity. Submitted
requests do not reserve quantity; approval rechecks the counter and either
posts the complete correction or writes nothing. `salesCredits` stores an
issued/remaining NGN minor-unit balance and changes from `active` to `redeemed`
when exhausted. The credit is valid only for its issuing branch and is consumed
inside the replacement sale transaction.

Cash refunds reference an open `posShifts` document. Approval increments the
shift's `cashRefundsMinor`; closing cash is reconciled as opening cash plus cash
sales minus approved cash refunds.

An approved customer's `outstandingBalanceMinor` and `availableCreditMinor`
are transactional projections. Every change is backed by an immutable
`customerAccountEntries` record and a posted journal. Credit sales increase the
balance and debit account `1100`; payments decrease it and credit account
`1100`. Credit status and limit changes never delete or reduce an outstanding
balance.

Money is integer NGN minor units. VAT rates are basis points. Product and
branch price documents are versioned. A branch price records the central base
version against which it was created or approved.

Purchase orders snapshot product, cost, VAT, supplier, warehouse, and receiving
location data. A physical `purchaseReceipts` record is backed by the existing
inventory transaction and entries. Supplier invoice approval, rather than PO
approval or goods receipt, creates the Accounts Payable journal and supplier
account entry. `purchaseInvoiceItemCounters` prevents approved invoice matches
from exceeding received quantities. Payments add allocations and correcting
subledger/journal records without rewriting the invoice.

Operating expenses use an automatically reused or created category plus an
optional branch or warehouse dimension. Approval posts accounts `6000`, `1300`,
and `2100`; later disbursements clear `2100` against the recorded settlement
account. Expense status is a projection of the immutable approval and payment
evidence, and cannot be mutated by Firestore clients.

`bankAccounts` stores only the last four account-number digits and maps one
real bank account to one unique 10xx ledger code. Statement transactions use a
deterministic fingerprint for duplicate protection. Matching adds links between
otherwise immutable statement and journal-line evidence; it never changes a
journal amount. A closed `bankReconciliations` record snapshots the period,
balances, signed movement, included identifiers, zero difference, preparer,
and independent closer.

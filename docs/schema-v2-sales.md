# Sales schema version 2

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
| Accounting | `chartOfAccounts`, `journalCounters`, `journalEntries`, `journalLines` |
| Existing ledger integration | `inventoryTransactions` and `inventoryEntries` using `branch_sale`; `inventoryBalances` remains the mutable projection |
| Reliability/control | existing `idempotencyKeys`, `auditLogs`, plus browser-local queued drafts that are not authoritative records |

Every confirmed sale is created in one Firestore transaction with its receipt,
payment, paired inventory entries, balance update, COGS, journal, audit record,
and idempotency record. Confirmed records are append-only. Later returns and
refunds must add linked correcting records rather than editing the original.

An approved customer's `outstandingBalanceMinor` and `availableCreditMinor`
are transactional projections. Every change is backed by an immutable
`customerAccountEntries` record and a posted journal. Credit sales increase the
balance and debit account `1100`; payments decrease it and credit account
`1100`. Credit status and limit changes never delete or reduce an outstanding
balance.

Money is integer NGN minor units. VAT rates are basis points. Product and
branch price documents are versioned. A branch price records the central base
version against which it was created or approved.

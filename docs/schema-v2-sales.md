# Sales schema version 2

Schema version 2 is an additive sales and accounting extension to the frozen
warehouse schema v1. Existing inventory, request, and transfer records retain
their meaning.

| Classification | Collections |
|---|---|
| Sales configuration | `productSalesPrices`, `branchSalesPrices` |
| POS operation | `posShifts`, `posShiftLocks`, `salesCounters` |
| Immutable sale evidence | `sales`, `saleItems`, `salePayments`, `salesReceipts` |
| Accounting | `chartOfAccounts`, `journalCounters`, `journalEntries`, `journalLines` |
| Existing ledger integration | `inventoryTransactions` and `inventoryEntries` using `branch_sale`; `inventoryBalances` remains the mutable projection |
| Reliability/control | existing `idempotencyKeys`, `auditLogs`, plus browser-local queued drafts that are not authoritative records |

Every confirmed sale is created in one Firestore transaction with its receipt,
payment, paired inventory entries, balance update, COGS, journal, audit record,
and idempotency record. Confirmed records are append-only. Later returns and
refunds must add linked correcting records rather than editing the original.

Money is integer NGN minor units. VAT rates are basis points. Product and
branch price documents are versioned. A branch price records the central base
version against which it was created or approved.

# Business workflow expansion (24 September 2026 baseline)

This roadmap extends the existing Firebase application and preserves historical users, stock entries, sales, journals and audit records. A requested capability is not marked complete merely because a screen or a partial workflow exists.

| Request | Current implementation | Remaining work |
| --- | --- | --- |
| Daily physical stock and cash reconciliation | Stock counts, inventory-ledger reconciliation, POS opening/closing cash variance and bank reconciliation exist; `/daily-reconciliation` links the existing controls | One dated, location-scoped daily close including non-POS cash movement, reviewer/sign-off and exception reporting |
| Administrator-managed roles | Organization-specific role creation/editing, multiple role assignment, permission versioning and effective union authorization exist | Regression coverage for newly introduced permissions and deactivation across all modules |
| User disable/delete | Administrators can make accounts inactive or suspended; Auth is disabled and sessions are revoked; Users now has a direct Disable action | Do not hard-delete users with historical activity. Add archival/anonymization only with an explicit retention policy |
| Purchase order to payment | Draft/submitted/approved PO, goods receiving, supplier invoice approval, and supplier payment with audit and journals | Supplier advances, credit balances, remittance allocation, richer GRN printout and statement |
| Logistics and outsourced services | Transfer costs and aftersales charges/payments exist | External provider payables, service-item costing, payment accounts, balanced journals and provider statements |
| Retail and wholesale prices | Central base price and store override with version checks | Effective-dated price tiers, POS tier selection, authorization, offline snapshot and audit of manual overrides |
| Product stock ledger/history | Immutable inventory entries and paginated product movement history exist | Human-readable running balance across reservations, collection and all future transaction types |
| Customer account arrangements | Customer identity, credit decisions, payments and account entries exist | Multiple named arrangements/subaccounts per customer with allocation and consolidated statements |
| Financial statements | Ledger-derived balance sheet, income statement, cash-flow statement and trial balance with CSV export exist | Opening-balance/COA review, complete transaction classifications and accountant sign-off before external use |
| Waybill, quotation and proforma | Official sale invoice/receipt printing and transfer waybill reference exist | Issued and versioned quotation/proforma conversion, physical-release-linked A4 waybill and reprint controls |
| Returns/exchanges | Partial returns, refunds, customer-account and exchange credit exist | Linked replacement sale with automatic difference settlement either direction, inventory disposition and balanced posting |

## Dependency sequence

Current priority: complete paid-but-uncollected stock and partial physical collection before further reporting/financial expansion. Then replace browser-wide dashboard scans with bounded server aggregates and remove financial report truncation before statement sign-off.

1. Daily-close evidence and organization-specific role/permission model, with server-authoritative authorization and safe migration.
2. Retail/wholesale price tiers and customer subaccounts, preserving offline POS and existing credit balances.
3. Supplier advances, logistics/service payables, and complete cash/bank posting.
4. Return-for-replacement settlement, collection and stock disposition.
5. Versioned quotations/proformas, physical-release waybills, and final statement/report sign-off.

Each vertical slice needs rules/index review, idempotent trusted mutations, audit events, emulator tests, typecheck, lint, production build and a verified staging rollout. No historical ledger or issued document is edited in place.

## Customer register and history — October 2026

The customer register uses bounded, organization-scoped Firestore cursor queries,
25/50/100 rows, field-specific prefix search, desktop tables and compact-screen
cards. Inline history shows five recent activities and links to the full history
page. The existing history callable now pages sales, returns and account entries
together without downloading the complete account history or rewriting records.

Customer repayments and bank/card sale refunds now use the existing active
company bank-account resolver, preserve account snapshots and journal links,
and audit the selected ledger account. Earlier unapproved refunds require an
account at approval; historical posted clearing-account journals are not moved.
Cash remains on cash-on-hand, with cash refunds tied to an open POS till.

## Paid goods and physical collection — 6 October 2026

Payment confirmation now offers immediate collection or reservation for later.
For later collection, physical quantity/value remain unchanged; reserved stock
increases and available stock decreases. Revenue/payment posting happens at
confirmation; inventory cost and cost of goods sold post when goods leave.
The POS collection queue is store-scoped and cursor-paginated (25/50/100).
Partial collections create append-only release evidence, paired stock entries,
balanced cost journals, and audit events atomically, with retry idempotency.
Returns cannot exceed physically collected quantities.

Additive schema: new sales/items contain collection tracking fields; historical
sales without them retain their existing already-issued interpretation. No old
ledger records are rewritten. Built-in managers/admins receive stock-release
permission; administrators explicitly assign it to custom roles as needed.
Existing immediate/offline checkout remains immediate issue. Deferred collection
requires online confirmation and supports the current quantity-based POS items.
Reservation cancellation/refund before collection, serial-evidence POS collection,
long-uncollected reminders and release-linked waybills remain next steps. Do not
automatically expire reservations or use a goods return for uncollected stock.

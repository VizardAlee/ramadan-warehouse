# Business workflow expansion (24 September 2026 baseline)

This roadmap extends the existing Firebase application and preserves historical users, stock entries, sales, journals and audit records. A requested capability is not marked complete merely because a screen or a partial workflow exists.

| Request | Current implementation | Remaining work |
| --- | --- | --- |
| Daily physical stock and cash reconciliation | Stock counts, inventory-ledger reconciliation, POS opening/closing cash variance and bank reconciliation exist; `/daily-reconciliation` links the existing controls | One dated, location-scoped daily close including non-POS cash movement, reviewer/sign-off and exception reporting |
| Administrator-managed roles | Multiple centrally defined roles per user; server authorization is the union of roles; administrators can assign roles | Safe organization-specific role creation/editing, permission versioning, migration of old assignments, and synchronized server/UI/rules enforcement |
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

1. Daily-close evidence and organization-specific role/permission model, with server-authoritative authorization and safe migration.
2. Retail/wholesale price tiers and customer subaccounts, preserving offline POS and existing credit balances.
3. Supplier advances, logistics/service payables, and complete cash/bank posting.
4. Return-for-replacement settlement, collection and stock disposition.
5. Versioned quotations/proformas, physical-release waybills, and final statement/report sign-off.

Each vertical slice needs rules/index review, idempotent trusted mutations, audit events, emulator tests, typecheck, lint, production build and a verified staging rollout. No historical ledger or issued document is edited in place.

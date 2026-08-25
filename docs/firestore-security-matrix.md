# Firestore security matrix

| Data | Client read | Client write | Scope |
|---|---|---|---|
| Users/org units | own or administrators | denied | organization and assignments |
| Products | permitted operational roles | denied | organization |
| Transactions/entries/balances | role-filtered; costs restricted | denied | organization plus warehouse/branch |
| Serials/lots | cost-authorized operational roles | denied | organization plus location scope |
| Requests and workflow records | role/branch scoped | denied | organization and branch |
| Transfers/items/packages/picks | role/route scoped | denied | organization, origin warehouse, destination branch |
| Dispatches/receipts/discrepancies | related-transfer scoped | denied | related transfer |
| Costs/approvals/audit | elevated roles only | denied | organization |
| Reservations | warehouse/admin/auditor read | denied | related transfer |
| Product/base sales prices | permitted product roles | denied | organization |
| Branch prices, sales, items, payments, receipts, shifts | administrator/finance/auditor or assigned branch sales roles | denied | organization and branch |
| Chart of accounts and journals | system administrator, finance, auditor | denied | organization |
| Notifications, outbox, idempotency, rate limits | denied | denied | server only |

For multi-role profiles, read authority is the union of assigned roles while every organization, branch, warehouse, and related-record scope check still applies. Legacy single-`roleId` profiles and canonical `roleIds` profiles are both recognized during migration.

The final recursive rule denies every unlisted read and write. Authoritative workflow, ledger, notification, audit, and projection mutations are callable/Admin SDK only. Storage is deny-all.

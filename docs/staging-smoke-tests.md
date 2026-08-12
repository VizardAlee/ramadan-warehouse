# Staging smoke tests

Record build revision, explicit staging project ID, tester, time, actor role, input IDs, observed ledger transaction IDs, balance deltas, and pass/fail for every check. Use synthetic data and do not run against production.

| Area | Checks |
|---|---|
| Authentication | Login; disabled-user denial; role change takes effect after token refresh; branch and warehouse assignment boundaries |
| Product/inventory | Create quantity product; authorized opening stock; serial receipt; lot receipt; inventory reconciliation is clean |
| Branch request | Create, submit, approve, partially approve, request changes, edit, and resubmit with version/audit history |
| Transfer | Request-linked and direct creation; reserve, pick, independent check, pack, seal, dispatch, full/partial receipt, discrepancy resolution, cost reconciliation, closure |
| Costs | Estimate, approval, actual cost, finance-only visibility and reconciliation |
| Security | Cross-branch and cross-warehouse denial; unauthorized cost/direct-transfer/ledger denial; App Check rejection after enforcement |
| Operations | Liveness/readiness; scheduled job evidence; notification log adapter; integration no-op adapter; warehouse and transfer reconciliation |

For every physical movement verify a new immutable `inventoryTransactions` record, balanced entries, exact source/destination balance changes, and unchanged earlier transaction documents. A smoke failure blocks acceptance and deployment progression.

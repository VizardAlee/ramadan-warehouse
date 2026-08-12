# Performance and scaling

Operational lists use bounded limits and stable document cursors. Reconciliation is limited to 500 related records per collection and organization reports to 100 transfers per call; larger organizations need partitioned background reports. Transfer counters are route/year hot documents under unusually high creation concurrency; inventory balances and reservation documents are intentional transactional contention points.

Risks to watch: transfer detail fan-out, report scans, `in` query limits, package/serial arrays approaching document limits, and N+1 reconciliation calls. Prefer batched reads, cursor pagination, organization/date partitions, and maintained summary documents with reconciliation controls. Do not denormalize ledger truth.

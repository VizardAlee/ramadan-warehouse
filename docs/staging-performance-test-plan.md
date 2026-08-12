# Staging performance baseline plan

Generate synthetic, namespaced staging data through a guarded non-overwriting loader: 1,000 products, 10,000 movements, 5,000 requests, 5,000 transfers, 25,000 transfer items, and 50,000 audit records. Never run this plan in production or against client data.

Measure cold and warm p50/p95/p99 latency, query reads, payload size, error rate, index use, and Functions duration for product search, stock position, SKU history, request list, transfer list, picking queue, incoming transfers, reconciliation, and every report page. Use at least 100 measured requests after warm-up, concurrency 1/5/20, and fixed seed/revision IDs.

Initial targets are p95 ≤ 1.0 s for indexed lists/search, ≤ 2.0 s for detail/history pages, ≤ 5.0 s for paginated reports and bounded reconciliation, zero unbounded collection scans, ≤ 1% errors, and stable memory without timeout. These are acceptance targets, not claimed measurements. Store raw results outside the repository and publish a redacted summary with environment, revision, dataset counts, index state, and regressions.

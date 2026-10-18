# Selected-location inventory candidate

This candidate is based on live `bea2902ba7743f3c0f1da3857fb996038a67bc1f`. It integrates the five-file location filter input patch (`266887e1cdc239e74a236c34fce2af0aaf8ba4c3ddef0e34eeba59fb421ecbf4`) and addresses its read-performance and mixed-role precedence concerns. It is local and unpublished; independent review, publication approval and normal release gates remain required.

## Behavior and authority

| View | Required behavior |
| --- | --- |
| Selected Store | Resolve its `inventoryLocations.branchId` matches and request only those inventory-location IDs. |
| Selected legacy warehouse | Resolve `inventoryLocations.warehouseId`; an equal branch ID never merges these identities. |
| Empty or unmapped location | Show a clear empty state; never fall back to an unfiltered organization query. |
| Existing zero balance | Keep the product's location membership; absence of on-hand quantity is not absence of history. |
| Authorized All locations | Preserve the existing organization-wide inventory view and complete product catalogue, including services. |
| Assigned or mixed-role reader | Use only the already validated role/assignment and selected context; no new grant, role or rule. |
| Identity/location switch | Clear old rows/errors/pagination immediately; ignore late responses and stop further old membership requests. |
| Refresh/retry | Start again at the first inventory page and refresh totals or catalogue membership. Stocked catalogue imports request a membership refresh without changing the import/posting operation. |

`requireAccess`, permission checks, the role catalogue and cost permissions remain unchanged. The read query scope chooses an assigned branch when the validated profile has `branch_manager`, an assigned branch and no warehouse IDs after context narrowing. Warehouse-only roles gain no branch authority. Other reads retain their existing scope; reconciliation uses the original precedence and its write/audit implementation is byte-identical to the live base.

Selected-location metadata reads also constrain `inventoryLocations` by the explicit `branchId` or `warehouseId`. The existing collection hook accepts this optional equality scope and hides prior scoped metadata while its new snapshot loads; callers without that option retain their existing query behavior. An organization-wide metadata query is not a substitute for assignment-scoped access under the unchanged Firestore rules.

## Bounded reads

The existing `generateStockPositionReport` endpoint supports two views; no new callable registration is added.

- `positions` retains the existing limit of 100 (UI 25/50/100), with one lookahead record to determine the next cursor. The UI requests one page, not the complete balance set. The initial whole-scope aggregate summary is reused when paging and refreshed explicitly or on scope changes.
- `membership` returns only document/product IDs, at most 500 per response, with no costs or aggregate totals. The catalogue stores unique product IDs, not full balance records. This still requires scanning matching membership records before the complete catalogue count is displayed; it is not an indexed distinct-product directory.
- `locationId` remains compatible with existing clients. The optional `locationIds` list contains up to 300 inventory-location IDs, deduplicated and grouped into at most 30 per Firestore query. At most three groups run concurrently. Global document-ID cursor order is preserved when merging groups. Empty lists and combining the single/list filters are rejected.
- Aggregate fields and cost redaction follow the existing report behavior. The UI preserves the established Restricted label when the server omits a cost, even if a cached profile still appears to allow costs. All stock queries remain constrained to the actor's organization and existing branch/warehouse authority.
- Exact page multiples do not need a final empty membership request. A cancelled scope stops subsequent requests and cannot publish its late result.

The query catalogue explicitly covers the new location `in` filters. Its baseline must be refreshed only from a successful genuine planner-only live Explain audit of this exact source. No index-manifest or index deployment is part of this candidate.

## Readiness limits

Paging and aggregate requests do not form one atomic database snapshot; concurrent postings may change different page reads. Refresh obtains current data. Membership remains O(matching balance documents), with O(unique product IDs) client storage; inventories with many lots/areas can require several lightweight requests. The 300-area input bound fails clearly rather than truncating or falling back to All locations. No production-volume claim is made.

No stock posting, entity-ID rewrite, migration, backfill, historic repair, payment/accounting change, role grant, rules/IAM/App Check/secret change or unrelated audit/profitability/expense/privacy feature is included. Full product detail retains its existing authorized behavior; the inline catalogue preview is explicitly location-scoped.

## Evidence

Validation receipts and synthetic browser evidence are kept outside the repository under the task's `ramadan-inventory-integration-*` prefix. Final counts and exact candidate hashes belong in the external integration handoff after all gates pass. No production writes or real payments are permitted for validation.

# Transfer architecture

Phase 4 uses organization-scoped `transfers` headers and top-level `transferItems`. A transfer starts from either an exact approved branch-request version/approval or a direct administrator allocation with a mandatory reason. Server-side counters generate immutable `TRF-{warehouse}-{branch}-{year}-{sequence}` references. Submission writes immutable `transferVersions`; review decisions write append-only `transferApprovals` and `transferEvents`.

The stock source of truth remains the Phase 2 journal. `stockReservations` and balance `reservedQuantity` are operational projections only. Dispatch and receipt call the central inventory posting service with a narrow internal transfer capability; callable input schemas cannot request that capability. The posting service remains responsible for inventory transactions, double-sided entries, balances, lots, serial location, costing, idempotency, and audit.

Route-specific, branch-bound virtual transit locations are created server-side (`transit__{organization}__{branch}`). This avoids one location per transfer while preserving branch-route reconciliation. Transit is unavailable stock. Missing goods remain there until a later-delivery, return, damage, or write-off movement resolves them.

Firestore clients cannot write authoritative transfer records. Transfer headers include cost totals, so branch and quantity-only roles read sanitized callable responses; Firestore rules cannot safely hide fields inside a document.

Known hardening: configurable multi-stage value thresholds are design-ready but not a visual policy engine; binary evidence, reopening, carrier APIs, and maintained high-volume reporting aggregates remain deferred.

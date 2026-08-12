# Data retention classification

Final retention periods require Nigerian legal, tax, contractual, privacy, and client-policy review. Until approved, no automatic deletion applies to financial or stock history.

| Data | Default expectation |
|---|---|
| Inventory ledger/entries, costs, receipts, stock adjustments | Permanent or statutory financial period plus legal hold; append-only |
| Audit logs, approvals, versions, request/transfer events | Minimum seven years unless counsel sets longer; preserve integrity |
| Requests, transfers, discrepancies | Keep with their complete history for the financial retention period |
| Notifications | Delivery metadata 12–24 months; minimize/redact message content where possible |
| Integration outbox | Payload/result metadata 12–24 months after terminal state; retain correlation/audit reference longer |
| Attachments when implemented | Classified per linked business record; malware scan, access controls, and legal hold required |
| Authentication records | Active account lifetime plus approved offboarding/security retention; disable before deletion and preserve audit identity |

Deletion must be tenant-scoped, authorized, logged, legal-hold aware, restore-tested, and must never orphan immutable business records. Prefer pseudonymizing expired personal fields while retaining non-personal transaction identity. Backups must follow the same expiry and hold policy.

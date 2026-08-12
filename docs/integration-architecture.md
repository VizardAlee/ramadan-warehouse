# Branch application integration architecture

The warehouse owns dispatch intent, transit, receipt, discrepancies, and its ledger. The existing branch application is unchanged. Committed warehouse transactions create a same-transaction Firestore outbox record with deterministic idempotency identity. A future bounded worker validates the schema, invokes a noop/log/mock or approved real adapter, records retries, and dead-letters after eight attempts.

Consumers store event IDs/idempotency keys before applying effects. Acknowledgements are inbound versioned events, not direct warehouse status writes. Reconciliation compares outbox delivery/acknowledgement with warehouse receipts; it never silently repairs either system.

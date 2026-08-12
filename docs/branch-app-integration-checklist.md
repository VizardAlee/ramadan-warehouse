# Branch app integration checklist

- Agree ownership, SKU/branch mappings, event schemas, authentication, endpoint allowlist, timeouts, retry/dead-letter limits, and support contacts.
- Prove duplicate/out-of-order delivery, replay, partial receipt, cancellation, discrepancy, and outage behavior in staging.
- Implement consumer idempotency and acknowledgement storage before enabling delivery.
- Reconcile dispatched/received quantities and event/ack status daily during rollout.
- Define rollback to noop adapter; never allow the branch app to write the warehouse ledger or transfer status directly.

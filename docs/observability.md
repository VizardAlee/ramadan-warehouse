# Observability

Critical logs use correlation ID, function, organization, actor UID where present, entity type/ID, operation, outcome, duration, stable error code, idempotency key, and retry count. Never log passwords, reset/action links, ID/App Check tokens, bootstrap secrets, full sensitive documents, or file contents.

Scheduled handlers emit bounded completion summaries. Correlation IDs should flow from callable to inventory transaction, audit record, notification, and integration outbox. Log-based metrics must aggregate stable codes, not parse human messages.

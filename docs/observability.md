# Observability

Critical logs use correlation ID, function, organization, actor UID where present, entity type/ID, operation, outcome, duration, stable error code, idempotency key, and retry count. Never log passwords, reset/action links, ID/App Check tokens, bootstrap secrets, full sensitive documents, or file contents.

Scheduled handlers emit bounded completion summaries. Correlation IDs should flow from callable to inventory transaction, audit record, notification, and integration outbox. Log-based metrics must aggregate stable codes, not parse human messages.

Scheduled handlers retry transient platform failures three times within ten minutes with bounded backoff and a 120-second timeout. They retain scale-to-zero. Monitoring treats isolated cold-start failures and latency outliers as diagnostic evidence; paging requires a repeated or sustained incident. See `monitoring-and-alerting.md` for the deployed thresholds and verification procedure.

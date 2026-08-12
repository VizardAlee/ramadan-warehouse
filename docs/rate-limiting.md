# Rate limiting

High-risk CSV confirmation and reconciliation use Firestore transactional fixed windows keyed by organization, user, operation, and server-derived window. Excess returns stable `RATE_LIMITED`/resource-exhausted errors with retryability. Defaults are 30 transfer reconciliations/minute, 10 organization reports/minute, 20 previews/minute, and 3 confirmations/five minutes.

Bootstrap remains secret- and one-time-state protected. Extend the same service to provisioning, exports, attachment initialization, and manual retries when those endpoints are exposed. Monitor repeated failures before tightening limits; do not throttle normal dispatch/receipt flows aggressively.

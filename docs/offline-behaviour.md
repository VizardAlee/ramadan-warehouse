# Offline and connectivity behavior

The UI detects browser connectivity, displays a stale-data warning, and disables workflow confirmations while offline. Reservation, dispatch, receipt, discrepancy disposition, cost approval/reconciliation, and closure require online callable confirmation. Firestore offline writes are not enabled for authoritative data.

Safe local draft preservation may store non-sensitive form text with an explicit transfer/user key, expiry, and discard control. It must never auto-submit after reconnection. Every final action uses a unique idempotency key and refreshes server state after success.

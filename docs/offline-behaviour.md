# Offline and connectivity behavior

The UI detects browser connectivity, displays a stale-data warning, and disables workflow confirmations while offline. Reservation, dispatch, receipt, discrepancy disposition, cost approval/reconciliation, and closure require online callable confirmation. Firestore offline writes are not enabled for authoritative data.

Safe local draft preservation may store non-sensitive form text with an explicit transfer/user key, expiry, and discard control. General operational drafts must never auto-submit after reconnection. Every final action uses a unique idempotency key and refreshes server state after success.

The branch POS is the deliberate exception. After a cashier opens a device-bound shift online, its service worker and IndexedDB cache permit paid sales to continue from the last trusted catalogue, price versions, and branch quantity allowance. Each offline sale has a provisional receipt reference and UUID idempotency key and retries automatically on the browser `online` event. It never writes authoritative Firestore documents directly. The sale callable either posts the complete stock/payment/VAT/journal transaction once or leaves it visible in a manager-review queue for a stale price or stock reconciliation. Credit, returns, refunds, customer approval, new shifts, shift closure, and below-base price approval remain online-only.

The browser also retains the minimum last-verified access profile required to
reopen its cached POS shell offline. It is accepted only for an already
persisted Firebase Auth user and only to operate a previously opened assigned
branch shift. Logout removes that cached profile. Deactivation, role, branch,
and authorization-version checks remain authoritative on the server, so an
offline queue cannot bypass revoked access when it reconnects.
Cached workspaces and queued sales are keyed to that Firebase user as well as
the branch, so a second user on the same browser cannot inherit or post the
first cashier's offline shift.

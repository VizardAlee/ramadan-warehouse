# Notification delivery

The provider-neutral adapter supports `noop`, `log`, and in-memory emulator modes. Events carry a deterministic idempotency key, recipient roles/IDs, template key, channel preferences placeholder, delivery status, attempt count, last attempt/error, next retry, and dead-letter state. Completed/dead-letter events are not retried and attempts stop after five.

Email and SMS remain unconfigured. Browser push is a separate best-effort delivery of an existing in-app task, never the authoritative record.

## In-app inbox (first release)

Sales order receipt, payment acceptance, and completion, plus simplified stock-transfer changes, now fan out from the existing `notificationEvents` queue into `users/{uid}/notifications/{entityType}_{entityId}`. This is one current card per order or transfer per eligible user. Newer transitions replace older cards, so completed actions do not remain on the dashboard. The scheduled delivery worker runs each minute and retries failed events using the existing attempt policy. The write is idempotent and checks the source record before showing a task; superseded events are not materialized.

Recipients are resolved from active users' combined roles and assigned locations. Sales stages use the server permission map. Source managers act on new transfers; destination managers act after source approval. Organization administrators can act throughout. A user's inbox is readable only by that active user; the only client write allowed is setting `readAt` once. Event and business records remain server-owned.

The bell and dashboard action list show the most recent 50 inbox cards. No customer debt reminder or collection alert is implied by this release. In particular, the existing POS posts inventory release at payment confirmation and has no separate physical collection transition to notify yet.

## Optional browser push

Users enable push per browser from Notifications. The existing PWA service worker receives standards-based Web Push and opens the related in-app task. iOS users must install the app to the Home Screen before enabling. The client never receives the VAPID private key; `getWebPushPublicKey` returns only the public key. `saveWebPushSubscription` binds an endpoint to the authenticated active user. Sign-out unsubscribes the browser, and the delivery worker refuses deactivated users, stale cards and removed subscriptions. Firestore rules keep endpoint keys server-only.

`queueNotificationPush` creates a deterministic push-delivery record when an action card changes. `deliverPendingNotifications` sends queued pushes with capped retry. Browser notifications use a stable tag to replace duplicate attempts. A push failure does not roll back or delay the inbox card.

Configure `WAREHOUSE_WEB_PUSH_VAPID` in Firebase Secret Manager as JSON with `publicKey`, `privateKey`, and `subject` (a `mailto:` contact). Bind it only to `getWebPushPublicKey` and `deliverPendingNotifications`. Without this secret, browser push is unavailable but the in-app inbox continues to operate. Test on Chrome and Safari, including an installed iOS Home Screen app, before treating delivery as verified on those devices.

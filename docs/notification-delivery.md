# Notification delivery

The provider-neutral adapter supports `noop`, `log`, and in-memory emulator modes. Events carry a deterministic idempotency key, recipient roles/IDs, template key, channel preferences placeholder, delivery status, attempt count, last attempt/error, next retry, and dead-letter state. Completed/dead-letter events are not retried and attempts stop after five.

Email, SMS, push, and in-app providers must implement the same interface, resolve recipients inside the organization, redact provider errors, and preserve the event identity. No paid provider or credential is configured.

## In-app inbox (first release)

Sales order receipt, payment acceptance, and completion, plus simplified stock-transfer changes, now fan out from the existing `notificationEvents` queue into `users/{uid}/notifications/{entityType}_{entityId}`. This is one current card per order or transfer per eligible user. Newer transitions replace older cards, so completed actions do not remain on the dashboard. The scheduled delivery worker runs each minute and retries failed events using the existing attempt policy. The write is idempotent and checks the source record before showing a task; superseded events are not materialized.

Recipients are resolved from active users' combined roles and assigned locations. Sales stages use the server permission map. Source managers act on new transfers; destination managers act after source approval. Organization administrators can act throughout. A user's inbox is readable only by that active user; the only client write allowed is setting `readAt` once. Event and business records remain server-owned.

The bell and dashboard action list show the most recent 50 inbox cards. No email, SMS, browser push, customer debt reminder, or collection alert is implied by this release. In particular, the existing POS posts inventory release at payment confirmation and has no separate physical collection transition to notify yet.

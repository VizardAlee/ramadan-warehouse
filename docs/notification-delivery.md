# Notification delivery

The provider-neutral adapter supports `noop`, `log`, and in-memory emulator modes. Events carry a deterministic idempotency key, recipient roles/IDs, template key, channel preferences placeholder, delivery status, attempt count, last attempt/error, next retry, and dead-letter state. Completed/dead-letter events are not retried and attempts stop after five.

Email, SMS, push, and in-app providers must implement the same interface, resolve recipients inside the organization, redact provider errors, and preserve the event identity. No paid provider or credential is configured.

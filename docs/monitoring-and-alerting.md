# Monitoring and alerting

The production-converted `ramadan-warehouse-staging` project has enabled Cloud Monitoring policies for callable errors and latency, Scheduler failures, HTTPS uptime, App Check rejection changes, and warehouse operation failures. The enabled email channel is attached to the policies. Page only actionable symptoms; route backlog warnings to operations during business hours.

Dashboards should show p50/p95/p99 latency, stable error codes, transaction contention, job summaries, transit age, discrepancy age, and adapter queues by organization without exposing payloads.

## Scheduled-job reliability baseline

All three Scheduler handlers use the same platform-failure policy: three retries within ten minutes, 30-second initial and 120-second maximum backoff, two backoff doublings, and a 120-second Functions timeout. They deliberately retain `minInstances: 0` so idle instances do not create permanent cost. Handler-level idempotency and bounded queries remain the protection against duplicate work.

On 2026-09-01, notification delivery returned a transient 500 because no instance was available, and integration delivery completed milliseconds after its former 30-second request timeout. Subsequent scheduled runs completed successfully with empty queues; there was no evidence of lost business processing. The reliability baseline addresses those cold-start/transient cases without weakening authentication, App Check, or business controls.

Production alert thresholds are intentionally incident-oriented:

- Cloud Run 5xx and Scheduler failure policies require at least two failures in a five-minute alignment window.
- Cloud Run p95 latency alerts at more than five seconds sustained for ten minutes.
- HTTPS uptime alerts below 95% for five minutes, with a 30-second probe timeout.
- App Check rejection and warehouse-operation failure policies retain their security/operational thresholds.

After any change, verify the three Scheduler jobs remain enabled, their target Functions retain scale-to-zero and the reliability baseline above, all policies retain the intended notification channel, and the next automatic job executions complete normally.

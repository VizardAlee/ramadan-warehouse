# Monitoring and alerting plan

Create Cloud Monitoring alerts for callable error rate/latency, instance and invocation spikes, Scheduler failures, Firestore contention/denials, App Check rejection changes, notification/integration dead letters, reconciliation failures, expired reservations, stuck transit/disputed transfers, cost backlog, Storage growth, and billing thresholds. Page only actionable critical symptoms; route backlog warnings to operations during business hours.

Dashboards should show p50/p95/p99 latency, stable error codes, transaction contention, job summaries, transit age, discrepancy age, and adapter queues by organization without exposing payloads. Policies and notification channels require staging/production configuration and are not active yet.

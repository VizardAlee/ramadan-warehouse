# Branch request notification events

## Phase 4 transfer events

Phase 4 emits idempotent `transfer.*` events for submission, changes, approval, reservation, picking/dispatch readiness, dispatch, receipt, delay, discrepancies, cost approval/reconciliation, and closure. Operational recipients are operations administrators, assigned warehouse managers, and destination branch managers; cost events target finance roles. Monitoring is reminder-only and never auto-releases stock without policy.

Workflow transactions create idempotent `notificationEvents` records for submitted, review-started, changes-requested, resubmitted, approved, partially approved, rejected, and cancelled transitions. Records identify the organization, request, branch, request version, recipient groups, and pending delivery status.

Suggested recipients are the requester and branch managers for reviewer decisions, and operations/warehouse reviewer groups for submissions. The records are internal and client-inaccessible. No email, SMS, push provider, secret, or paid integration is configured in Phase 3; a future delivery worker must claim records idempotently and record delivery attempts without changing request history.

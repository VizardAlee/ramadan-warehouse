# Transfer workflow

## Normal transfers

New transfers use **Request stock → Administrator approves → Receiving manager confirms arrival**. Approval holds the goods automatically; full good receipt updates both locations and completes the transfer. Direct branch-to-branch supply is supported without involving the main warehouse. Packaging, picking, dispatch and transport forms are not mandatory for this flow. See [Simple stock transfers](simple-stock-transfers.md) for permissions, exception handling, inventory semantics and release status.

## Earlier transfers and optional detailed logistics

The controlled sequence is draft → submitted → review → approved → reservation → picking → packing and sealing → dispatch → destination receipt/discrepancy → cost reconciliation → closure. Partial operations maintain cumulative quantities. The core invariant is `received ≤ dispatched ≤ packed ≤ picked ≤ reserved ≤ approved`; damaged and rejected receipt dispositions cannot exceed dispatch outstanding.

Creators cannot approve their own detailed transfer. For detailed movements, one authorized origin-warehouse operator may perform picking, packing, sealing, and dispatch. Optional pick/package checks remain auditable but are not prerequisites. The destination receipt supplies the ordinary cross-location confirmation. A system administrator may complete receipt as an emergency organization-wide override; other users cannot confirm receipt for a dispatch they personally made. Approval targets the current immutable submitted version. Idempotency records make repeated submission, reservation, dispatch, receipt, and financial actions safe.

Request-linked quantities are allocated transactionally when a transfer is created. Only confirmed acceptable branch receipt calls `applyTransferFulfilmentToRequest`; dispatch never fulfils a request.

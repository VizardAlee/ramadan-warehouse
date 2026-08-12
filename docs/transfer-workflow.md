# Transfer workflow

The controlled sequence is draft → submitted → review → approved → reservation → picking/checking → packing/checking → dispatch → receipt/discrepancy → cost reconciliation → closure. Partial operations maintain cumulative quantities. The core invariant is `received ≤ dispatched ≤ packed ≤ picked ≤ reserved ≤ approved`; damaged and rejected receipt dispositions cannot exceed dispatch outstanding.

Creators cannot approve their own transfer. Picker/checker and dispatcher/receiver separation is enforced. Approval targets the current immutable submitted version. Idempotency records make repeated submission, reservation, dispatch, receipt, and financial actions safe.

Request-linked quantities are allocated transactionally when a transfer is created. Only confirmed acceptable branch receipt calls `applyTransferFulfilmentToRequest`; dispatch never fulfils a request.

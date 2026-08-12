# Branch receiving

Only an assigned branch receiver can confirm receipt, and the dispatcher cannot receive it. Transactional claims prevent simultaneous over-receipt. Accepted stock posts transit → branch available; damaged stock posts transit → branch damaged. Missing stock stays in transit.

Receipts support partial quantities, exact serials/lots, condition, notes, signature/photo metadata, and multiple receipts. Confirmed acceptable quantities alone update request fulfilment using a receipt-idempotent marker. Cost data is omitted without permission.

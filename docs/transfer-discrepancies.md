# Transfer discrepancies

Discrepancies preserve transfer, dispatch, receipt, item, type, quantity, serial/lot detail, description, assignee, evidence metadata, status, and resolution. Creation does not change inventory.

Later delivery moves transit to branch and applies request fulfilment only after that movement succeeds. Damage recorded at receipt is already moved to the damaged location; accepting that recorded condition creates no duplicate movement. A missing item later accepted as damaged moves transit to damaged, a return moves transit to an authorized return/origin location, and confirmed loss moves transit or damaged stock to an external write-off account. Receipt-created discrepancies include immutable item detail so each resolution can be reconciled to the exact SKU, lot, or serial. Every physical correction is a new immutable posting; prior transactions are never edited.

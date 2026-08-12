# Transfer quantity invariants

These formulas are the frozen version-1 accounting model. All quantities are non-negative integers and are evaluated per transfer item before being summed to the header.

`terminalDisposed = received + damaged + returned + writtenOff`

`undispatched = max(0, approved - dispatched - cancelledUndispatched)`

`inTransit = max(0, dispatched - terminalDisposed)`

`transferOutstanding = undispatched + inTransit`

This transfer-level value is distinct from request demand:

`requestOutstanding = approvedRequestQuantity - fulfilledRequestQuantity - explicitlyCancelledRequestDemand`

Cancelling an undispatched transfer remainder is not a request-demand cancellation. It removes the remainder from that transfer, releases only its unconsumed reservation, and reduces the request item's `transferAllocatedQuantity`. It does not reduce `approvedRequestQuantity`, increment fulfilment, or directly change `requestOutstanding`. The released request demand can be allocated to a later transfer.

Missing is an observation about stock still physically in transit, not a terminal disposition. Consequently `terminalDisposed + missing <= dispatched`. A later delivery moves missing to received; a confirmed loss moves missing to writtenOff; a warehouse return moves received to returned. No operation may count the same unit in two terminal states.

Reservation history is `reserved + releasedReservation`; current active reservation is represented by reservation documents' `remainingQuantity`. The ordering checks are `reserved <= approved`, `picked <= reserved + releasedReservation`, `packed <= picked`, and `dispatched <= packed`. Cancellation is limited by `cancelledUndispatched <= approved - dispatched` and cannot affect a confirmed dispatch.

Examples:

| Scenario | Transfer approved | Dispatched | Received | Damaged | Missing | Returned | Written off | Transfer cancelled | Transfer outstanding |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Full fulfilment | 20 | 20 | 20 | 0 | 0 | 0 | 0 | 0 | 0 |
| Partial dispatch | 20 | 12 | 0 | 0 | 0 | 0 | 0 | 0 | 20 |
| Partial receipt | 20 | 20 | 12 | 0 | 8 | 0 | 0 | 0 | 8 |
| Later delivery | 20 | 20 | 20 | 0 | 0 | 0 | 0 | 0 | 0 |
| Damage pending disposition | 20 | 20 | 18 | 2 | 0 | 0 | 0 | 0 | 0 |
| Return completed | 20 | 20 | 19 | 0 | 0 | 1 | 0 | 0 | 0 |
| Transit loss written off | 20 | 20 | 18 | 0 | 0 | 0 | 2 | 0 | 0 |
| Remainder cancelled and dispatched part received | 20 | 12 | 12 | 0 | 0 | 0 | 0 | 8 | 0 |

For the last row, if the transfer originated from a request approved for 20, the request state is independently `fulfilled = 12` and `requestOutstanding = 8`. Transfer closure is valid because transfer outstanding is zero; the request remains open for a later transfer of up to eight unless a separate authorized request-level action cancels or reduces that demand.

The executable source is `functions/src/transfers/quantity-invariants.ts`; its unit suite and callable acceptance workflows protect these formulas.

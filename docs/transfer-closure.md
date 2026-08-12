# Transfer closure

Closure rejects active reservations, unresolved discrepancies, unreconciled costs, incomplete dispatch disposition, or inconsistent totals. Terminal disposition reconciles received, damaged, returned, written-off, and explicitly cancelled remainder quantities against the approved quantity. It writes event/audit/notification records and locks operational mutation.

Before dispatch, cancellation releases reservations. After partial dispatch it cancels only undispatched remainder and preserves receipt responsibility. After receipt, correction uses discrepancies and closure. Reopening is deferred.

Transfer closure evaluates transfer quantities only. A request-linked transfer may close with zero transfer outstanding while its originating request still has approved outstanding demand. The cancelled transfer remainder returns to the request's allocatable pool; it is not fulfilment and it is not request-demand cancellation.

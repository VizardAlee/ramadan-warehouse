# Dispatch and transit

Confirmed dispatch posts `transfer_dispatch` from origin available stock to a destination-branch route transit location. It consumes reservation, reduces warehouse on-hand/reserved, increases transit on-hand, preserves organization quantity/value, and moves serials to `in_transit`.

Dispatch supports vehicle, driver, carrier, waybill, packages, verifier, expected arrival, and partial dispatches. Per-item posting keys prevent duplicate movement. Transit is unavailable to warehouse and branch. Outstanding equals dispatched less receipt/resolution movements; delayed stock is notified rather than silently altered.

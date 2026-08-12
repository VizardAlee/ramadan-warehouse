# Staging acceptance tests

Use distinct synthetic SKUs and retain evidence. Expected ledger effects are source debit plus destination credit except explicit external write-off.

1. **Normal Kaduna replenishment:** approved request → reservation → checked package → dispatch → receipt → fulfilment → reconciled cost → close. Origin decreases, transit returns to zero, Kaduna increases, request fulfilment equals approved quantity.
2. **Kano admin allocation:** direct transfer with approval and full receipt. Request collections remain untouched; Kano gains exactly the dispatched amount.
3. **Partial availability:** request 50, approve 30, transfers 20 and 10. Only 30 is fulfilled; unapproved 20 never becomes transfer demand.
4. **Missing delivery:** dispatch 12, receive 11. One remains in transit while discrepancy is open; later delivery creates a new movement, clears transit, and increments fulfilment once.
5. **Damage:** serialized inverter moves transit → damaged location. It has one current location; an authorized write-off creates a new transaction and never edits dispatch/receipt history.
6. **Return:** received branch stock moves through a return discrepancy to returned/quarantine, not available. A separate authorized inspection movement is required to reach available stock.
7. **Transit loss:** missing battery remains in transit until authorized resolution. Write-off moves exactly the loss to an external loss account, clears transit, and excludes it from request fulfilment.
8. **Cancel undispatched remainder:** request approved 20; Transfer A reserves/packages 20, dispatches 12, cancels the undispatched 8, receives 12, and closes. Transfer A ends with dispatched 12, received 12, cancelled 8, transit 0, and transfer outstanding 0. The request independently ends fulfilled 12 and outstanding 8. Cancellation releases only the undispatched reservation, cannot mutate the confirmed dispatch, does not count as request fulfilment, and makes the remaining eight available for Transfer B. A subsequent allocation of 8 must succeed and an allocation above 8 must fail.

Each scenario must finish with transfer reconciliation clean, organization inventory conserved except explicit write-off, no negative reservation, immutable history, expected audit events, and role/isolation denials tested.

Live staging classification on 2026-08-12: all eight scenarios passed. Scenario 8 passed under the authoritative rule that transfer-remainder cancellation and request-demand cancellation are separate business actions.

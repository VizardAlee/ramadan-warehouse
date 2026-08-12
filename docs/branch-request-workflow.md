# Branch request workflow

The implemented lifecycle is `draft → submitted → under_review → approved | partially_approved | rejected | changes_requested`. A changes-requested record becomes editable and can be resubmitted as a new formal version. Draft, pending, and approved requests may be cancelled only under the role-specific policy. Terminal decisions can be closed by elevated roles.

Approved request demand is independent of any one transfer. Cancelling an undispatched transfer remainder releases that transfer's allocation but does not reduce the request's approved or outstanding quantity. Confirmed receipts increment fulfilment; cancelled transfer quantities do not. Remaining approved demand may be allocated to another transfer unless a separate authorized request-level cancellation reduces it.

Draft items are unique by product and require positive integer quantities. Submitted data is not edited in place: the reviewer must return it for changes. Every submission creates an immutable header/item snapshot and increments `version`. Final decisions must account for every requested unit, so `approved + rejected = requested` on each item. Fulfilled quantity remains zero in Phase 3.

The default local policy is two-party material approval: an assigned branch user submits and a different operations administrator or warehouse manager decides. Branch managers manage demand for assigned branches but have no final warehouse approval by default. Organization settings may later add branch, finance, executive, value, priority, category, or SKU stages.

# Request approval model

Every formal material decision creates an immutable `branchRequestApprovals` document containing organization, branch, request, evaluated version, stage, decision, approver identity/role, complete item decisions, reason, timestamp, and correlation ID. Changes-requested decisions are also recorded.

The server rejects self-approval, cross-organization decisions, inactive actors, stale versions, incomplete decisions, over-approval, negative quantities, and decisions against terminal requests. Reviewers cannot rewrite requested quantities. Rejection requires a reason; partial approval is derived from item totals rather than trusted client status.

Estimated value is calculated from current trusted warehouse balances only when the caller has `requests.cost.read`. Cost values are never stored in broad request records and are omitted from unauthorized responses. Availability and estimated value are informational and do not promise fulfilment.

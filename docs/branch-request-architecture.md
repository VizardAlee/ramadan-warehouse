# Branch request architecture

Phase 3 stores demand separately from physical stock. `branchRequests` contains the current header and server-calculated totals. Top-level `branchRequestItems` contains product snapshots and requested/decision/fulfilment quantities for efficient organization, branch, and product reporting. Product IDs remain authoritative; SKU, name, unit, category, brand, and tracking type are resolved from trusted active product documents.

All writes use App-Check-protected callables, trusted user profiles, Zod input validation, Firestore transactions, idempotency records, audit logs, and request events. Clients cannot directly mutate request workflow collections. Request creation uses a branch/year counter and `REQ-{BRANCH}-{YEAR}-{SEQUENCE}` numbers.

Requests never invoke the inventory posting service. Approval does not reserve stock, create entries, change balances, or move serials/lots. Availability is a point-in-time reviewer aid with an explicit non-reservation warning.

`functions/src/requests/apply-transfer-fulfilment.ts` defines the future Phase 4 integration shape but has no implementation or callable export. A future request-origin transfer will use `sourceType = branch_request` and a request ID; a direct allocation will use `sourceType = admin_allocation` without a request ID.

Known limits: attachments are metadata placeholders, policy configuration is schema/documentation-ready rather than a visual rule engine, and report exports cover loaded server-filtered pages.

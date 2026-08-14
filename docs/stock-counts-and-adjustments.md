# Stock counts and adjustments

Stock counts follow `draft → in_progress → submitted → reviewed → posted`. Starting snapshots balance versions, quantities, and serial identifiers. If any balance moves while the snapshot transaction is created, the start aborts and must be retried.

Assigned counters can submit only an in-progress count. In blind mode, expected quantities and serials are removed from their callable workspace until submission. Submission records counts and variances but does not change inventory. Serial-tracked items require an exact, unique serial list equal to counted quantity.

Review enforces maker-checker: the creator or submitter cannot review. Posting also requires a different user from the reviewer. Each non-zero variance posts through the central ledger service with a deterministic idempotency key and a stock-count reference; only after corrections exist does the count become posted. Posted records have no client mutation path.

Direct stock adjustments are available to system administrators and branch or warehouse managers within their selected assigned location. Every adjustment needs a reason and posts immediately through the ledger. There is no draft/approval record in this option, so adjustment creation and approval audit events are not applicable; `inventory.stock_adjustment` records the posting. Large-value thresholds, drafts, and a distinct approver are required before expanding adjustment authority beyond managers.

Corrections to any posted movement use reversal and reposting, never editing.

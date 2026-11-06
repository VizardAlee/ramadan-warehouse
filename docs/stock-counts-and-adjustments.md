# Stock counts and adjustments

Stock counts follow `draft → in_progress → submitted → reviewed → posted`. Starting snapshots balance versions, quantities, and serial identifiers. If any balance moves while the snapshot transaction is created, the start aborts and must be retried.

Assigned counters can submit only an in-progress count. In blind mode, expected quantities and serials are removed from their callable workspace until submission. Submission records counts and variances but does not change inventory. Serial-tracked items require an exact, unique serial list equal to counted quantity.

Review remains a distinct, auditable transition. An assigned manager or administrator may review a count they created or submitted, removing the need for a second operational account. Non-manager roles cannot self-review. Posting remains a separate permission and each non-zero variance posts through the central ledger service with a deterministic idempotency key and stock-count reference. Posted records have no client mutation path.

Direct stock adjustments are available to system administrators and branch or warehouse managers within their selected assigned location. Every adjustment needs a reason and posts immediately through the ledger. There is no draft/approval record in this option, so adjustment creation and approval audit events are not applicable; `inventory.stock_adjustment` records the posting. Large-value thresholds, drafts, and a distinct approver are required before expanding adjustment authority beyond managers.

Corrections to any posted movement use reversal and reposting, never editing.


## Opening stock corrections

The opening-stock ledger entry offers a correction action only when the selected product/location balance still points to that opening movement and the user has both reversal and opening-stock permissions. The server independently checks reversal eligibility and rejects later inventory activity or an ineligible accounting period.

Correction has two explicit steps: reverse the eligible original entry with a reason, then review and post its replacement. Reversal immediately removes the old entry's stock and valuation; the replacement is not posted until the user confirms its quantity, location, date, and cost. Both movements and their linked accounting evidence remain in history. A reviewed replacement cost does not change the global product cost default.

If the opening stock has subsequently moved, use an authorized ledger adjustment for a quantity correction and accounting review for valuation. Posted opening stock is never edited in place.

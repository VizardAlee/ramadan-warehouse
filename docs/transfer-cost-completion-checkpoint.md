# Transfer landed-cost completion checkpoint, 14 November 2026

**UNRELEASED. Do not merge or deploy this branch.** Based on 5485cf0f; isolated from the main 896d60b production release. Original partial edits were copied from ramadan-transfer-landed-cost without altering that worktree.

## Completed in this checkpoint
- Fixed existing TypeScript errors in pricing, held-supplier-credit context and tests.
- Added pure deterministic receipt-valuation planner with dual company/branch-management cost, cumulative freight, damaged goods and exact serial allocation.
- Integrated planner into stock-transfer receipt balances, serials, movements and balancing external-value entries.
- Added unit tests and a full transaction fixture: source carrying value101, agreed value2000, freight7 yields company inventory108 and branch-management inventory2007, exactly7 capitalized across partial receipts.
- Typecheck passes. Five focused test files passed35 tests before final freight fixture; workflow fixture then passed10 tests including new freight test (36 combined distinct tests).

## Release blockers verified by independent read-only review
1. Immediate POS journal serialization in callable/sales.ts drops management debit/credit despite computing them. Deferred collection does preserve them.
2. accounting/stock-postings.ts and accounting/write-journal.ts do not persist management amounts for stock adjustment/count corrections/reversals.
3. branch-trading/returns.ts rejects every managementCostVersion invoice. New priced transfers all acquire that version. Implement evidence-aware original-cost supplier returns; do not simply remove guard.
4. callable/procurement.ts external supplier-return variance/evidence ignores managerial movement values.
5. Source-paid freight capitalization tags inventory asset to source/payer instead of receiving branch; consolidated correct but branch asset statements wrong.
6. product-margins.ts company-only basis must be explicitly labeled/aligned with new branch-management reports.
7. Verify generic reversal cannot reverse landed-cost receipts or restore original currentUnitCostMinor as well as management serial cost.

## Required before release
Complete above paths with regression tests, rebase onto current main carefully, run full emulator authorization/idempotency/concurrency/inventory/journal reconciliation and predeploy gates, UI verification, independent review. No live transfers, prices or financial data changed by this work. No feature push or deployment performed.

## Follow-up completion pass, 14 November
Implemented the previously identified gaps: managerial POS persistence, dual-basis journal validation (including zero-company/nonzero-manager lines), stock accounting and supplier-return reversal evidence, correct receiving inventory scope for freight, and report basis labels. Generic serial reversal now restores both bases; management-only linked accounting cannot bypass its journal.
Internal returns now reconstruct and revalidate original receipt costs, retain actual freight without refund, restore original supplier managerial basis, and record markup elimination in non-P&L account3990 rather than inventing an expense. Persisted returned managerial amounts prevent later partial receipts from repricing earlier returns. Quantity and serial transaction tests cover this.
Fixed pricing UI so zero freight omits optional transport payload; positive freight requires approved expense details.
Tests: focused group had61/62 passing, only remaining failure was outdated UI fixture missing mandatory requested quantity; corrected and rerun separately. Internal-return8 tests and backend typecheck passed. Full offline run was interrupted by HP disconnect; saw unrelated expense-scope UI failure. Emulator initialized but runtime failed loading saveProductSalesPrice during disconnection/resource pressure; no successful integration gate claimed.
**Still unreleased.** Must rerun complete integration/full unit gates on stable environment, rebase onto current production main and review conflict resolution, perform visual UI QA and independent final financial review before merge/deploy. Main896d60b production release is separately coordinated.

## Production integration verification
Integrated main896d60b in separate feature/transfer-cost-production-integration worktree, commit94c53bb. Preserved production additions; added parallel managerial delta to unposted purchase-cost correction. Frontend/backend typecheck passed. Integrated focused43 tests passed; original internal-trading emulator17 tests passed. Full pre-integration offline suite:1596 passed,4 query-baseline failures (only stale source fingerprint assertions). Independent targeted financial review of94c53bb found no new blockers.
Read-only staging planner retry verified855/855 query shapes, zero findings or missing indexes; earlier first8 transient500 responses did not count as verification. Baseline refreshed only from clean retry and matching source fingerprints. No indexes or business records were written. Prior index-inventory evidence date retained.
Integrated sales/procurement/internal-trading emulator suite is still pending; broader exact-SHA predeploy gates, visual UI QA and release coordination remain. No push or deployment from these feature worktrees.

## Final local validation checkpoint
Production-integrated Firebase emulator suite completed119 passed,1 skipped across sales, procurement and internal trading (552s). Full lint identified only three unused declarations; removed and targeted lint passed. Refreshed exact-source staging planner audit again after cleanup:855/855 passed, zero issues. Integrated focused43 and query-baseline14 tests passed; frontend/backend typecheck passed. No known implementation defect remained in targeted independent review.
User approval for a new public feature-branch push has not been obtained; root explicitly directed no feature push or PR. Therefore feature remains local and unreleased. Full exact-SHA production predeploy gate and visual QA remain necessary before deployment. Main production896d60b was released separately by deployment owner. Preserve feature/transfer-cost-production-integration and original completion branch during HP migration.

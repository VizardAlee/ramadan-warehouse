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

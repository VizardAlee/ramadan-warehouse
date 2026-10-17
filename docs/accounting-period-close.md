# Monthly accounting-period close

## Purpose

The monthly close proves that the posted journal is balanced, prerequisite
operational work is resolved, and every active bank account is reconciled for
the exact month. Preparing or closing a period locks journal posting by the
transaction's effective date. It does not rewrite sales, inventory, returns,
payables, expenses, payments, or bank evidence.

## Workflow

1. An administrator or finance officer opens **Month close** and selects an
   ended calendar month.
2. The workspace rebuilds the trial balance from that month's journal lines and
   reports total debits, total credits, journal counts, and blockers.
3. Finance resolves every blocker, then prepares the month. Preparation creates
   a hashed evidence snapshot and immediately locks the period against new
   journal posting.
4. A different authorized administrator or finance officer independently
   completes the prepared month. The application rebuilds and compares the
   evidence before atomically recording the close.
5. Later corrections must be posted with an effective date in an open month.
   Closed historical documents and journals remain immutable.

## Required evidence

- The calendar month has ended.
- Every journal entry and the aggregate trial balance have equal debits and
  credits, each header equals the sum of its lines, and there are no in-period
  orphan journal lines.
- Every active bank account has one closed reconciliation covering the exact
  first and last day of the month. A genuinely inactive month may reconcile
  with zero statement and ledger rows when opening and closing balances agree.
- No POS shift opened on or before month end remains open.
- No draft/submitted expense or supplier invoice dated in the month remains
  unresolved.
- No submitted customer return created in the month remains unresolved.

## Lock coverage and concurrency

POS sales, customer repayments, approved sale returns, supplier-invoice
approval, supplier payments, expense approval, and expense payments all read
the accounting-period record inside the same Firestore transaction that posts
their journal. `preparing`, `prepared`, and `closed` statuses reject posting.
This shared transactional read also prevents a posting transaction from racing
successfully against close preparation.

## Authority and audit

System administrators and finance officers have read, prepare, and complete
permissions. Auditors are read-only. The preparer cannot complete their own
close. Firestore clients cannot mutate accounting-period records; callable
operations are idempotent and write audit evidence.

## Current boundary

The close workspace provides trial-balance evidence and period locking. Formal
profit and loss, balance sheet, cash-flow, VAT, receivable, payable, and branch
profitability statements are the next finance-reporting phase.

## Store daily-close evidence compatibility

Daily-close business dates include the entire Nigerian day and exclude the next
midnight. New evidence carries hash version 2, preserving the exact seconds and
nanoseconds of cash postings. An unchanged legacy prepared or signed close is
compared using its original digest format and remains valid; no historical hash,
evidence snapshot or signature is rewritten by a workspace read. The legacy
comparison uses the corrected day membership and current totals, so newly
included final-nanosecond postings and genuine cash/stock/till changes still
require a reviewed revision.

Signing an unchanged legacy prepared close retains the prepared digest in the
new sign-off and records a separate precise validation digest for future checks.
Version-2 evidence and separately validated closes never fall back to the legacy
digest. Existing legacy signatures retain their original timestamp precision;
this compatibility path cannot recover precision that was never recorded. No
historical records are migrated or automatically signed by this change.

## Store daily-close action scope

Daily-close reading, preparation and sign-off each require their own permission
and store authority. Assigned managers retain their assigned-store actions.
Direct organization-wide roles retain only the global actions their role grants;
for example an auditor can read all stores without making a branch manager's
write actions global. An active same-organization custom global role must grant
the particular daily-close action explicitly. A custom operations base granting
only transfer reading does not widen daily-close access.

Store choices use daily-close reading authority. The workspace also reports
preparation/sign-off authority for the selected store, so globally readable
stores can show disabled write actions with an explanation. Prepare/sign retries
recheck current authority before acknowledging an old key. This authorization
change does not migrate, rehash or rewrite existing daily-close records.

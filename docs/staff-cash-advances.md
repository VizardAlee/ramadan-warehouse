# Staff and driver cash advances

Deployment must be verified separately. The role starting point does not automatically create or assign a role to a live user.

Daily checks → Staff/driver cash advances records money already handed to staff or drivers. It does not initiate bank transfers. Select the recording branch and actual payment account. Issue records a staff-advance asset, not an expense. Record supported operating expenditure only when the receipt has been checked and has not already been posted elsewhere. Record unused funds only after cash or bank receipt is verified. Neither event can exceed the remaining advance. An advance closes only when issued = recorded expenditure + returned funds.

## Authorization

System Administrator and Finance Officer: read, issue, retire documented operating expense, record return. Auditor: read-only. Four separate permissions use `cash.advances.read`, `.issue`, `.retire`, `.return`.

The Cash & Bank Reconciliation Officer starting point in Roles & permissions creates an **unassigned** role. It includes cash-close and bank-reconciliation preparation, journal/expense/payable read access, and advance read/return. It excludes issuing advances, recording expenditure, delivery payouts, approvals, journal reversals, stock changes and user management. Its finance-based scope is company-wide, including banking. Do not assign it if branch-only banking is required without a separate scope enhancement. Users are assigned separately; permissions combine with their other roles.

## Accounting and safeguards

Issue: debit1260 Staff and driver advances, credit actual cash/bank. Recorded operating spend: debit6000 Operating expenses, credit1260. Unused return: debit actual cash/bank, credit1260. Returns are not sales income or customer refunds. No VAT or inventory purchases are recorded through expenditure retirement. Cash1010 entries feed the store daily close.

Entries retain immutable events and journal references. Exact retries reuse the idempotency key; mismatching retry payloads are rejected. Spending receipt references are unique within this advance module across the organization. Return references are unique per advance; issue references are unique per branch and recipient. This does not check receipts already posted in other modules: staff must not double-record them. Accounting-period locks and branch/account ownership checks apply. Account1260 collisions fail closed instead of overwriting configuration. No client Firestore access is opened; all access uses scoped callable endpoints under existing default-deny rules.

## Verification

Use the demo emulators for all mutations. Exercise issue, partial expenditure, partial/final return, excessive settlement, concurrent settlement, exact retry, mismatched retry, duplicate evidence, foreign organization/account, closed accounting period, and read-only/restricted roles. Never create live test advances or payments.

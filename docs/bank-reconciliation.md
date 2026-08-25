# Bank reconciliation

## Purpose

Bank reconciliation proves that the application's bank ledger and an external
bank statement contain the same movements for a period. It does not download
bank data, initiate transfers, or alter posted accounting journals.

## Workflow

1. An administrator or finance officer creates a bank account using the bank
   name, account name, last four account-number digits, opening balance, and a
   unique 10xx ledger account code. The full bank account number is not stored.
2. Finance pastes statement rows as CSV or tab-separated data. Positive amounts
   are deposits and negative amounts are withdrawals. A deterministic
   fingerprint skips a row already imported for that bank account.
3. Each statement row is matched to one unused bank journal line. Deposits must
   equal a debit and withdrawals must equal a credit. Dates must be no more than
   31 days apart. An open match can be removed without editing either source.
4. Finance enters the statement period and exact opening and closing balances.
   Preparation is blocked unless every statement row and every bank-ledger line
   in the period is matched, statement movement equals ledger movement, the
   calculated closing balance equals the entered closing balance, and no closed
   period overlaps it.
5. A different authorized administrator or finance officer completes the
   prepared reconciliation. Completion atomically freezes every included match
   and closes the reconciliation. Closed evidence cannot be unmatched.

## Money invariants

- Money is stored as integer kobo and displayed as naira with two decimals.
- A statement transaction and journal line have a one-to-one relationship.
- Statement movement is the signed sum of deposits and withdrawals.
- Ledger movement is bank debits minus bank credits.
- `closing balance = opening balance + statement movement`.
- A reconciliation may close only when statement movement equals ledger
  movement and the final difference is exactly zero.
- A bank account with genuinely no statement or ledger activity may close a
  zero-row month when its opening and closing balances are equal.
- Matching metadata never changes debit, credit, journal, payment, sale,
  expense, supplier, or inventory evidence.

## Authority

System administrators and finance officers may manage accounts, import,
match, unmatch, prepare, and independently complete. The preparer cannot
complete their own reconciliation. Auditors have read-only access. All writes
are callable-only and audited; Firestore rules deny direct client mutation.

## Current boundary

The application accepts controlled pasted statement data rather than connecting
directly to a bank or Open Banking provider. Imported references are operator
evidence and are not confirmation by a bank API.

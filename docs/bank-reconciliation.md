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

## Reviewed bank opening balances

The balance and date entered while adding a bank account are reference metadata;
they do not create a ledger posting. Saving the bank account now creates or
verifies its unique chart-of-accounts mapping. Code 1010 remains reserved for cash.
Existing account metadata is never automatically converted into a journal.

An authorized accountant with bank-management access can select the bank in
**Banking → Post initial account balance**, load the setup, and enter the original
balance, effective date and time in Nigeria, evidence reference and reason. Select a reviewed active
non-system equity counterpart. If none exists, an authorized accountant creates
the appropriate equity ledger in Accounting first. Do not assume all brought-forward
funds are new owner capital; the counterpart must agree with the migration records.
The form shows the exact balanced debit and credit before explicit confirmation.
A negative signed amount represents a documented overdraft and reverses both sides.

The posting must precede any recorded bank transactions, use an open period, and
have no prior reconciliation or opening journal. Legacy incomplete history,
duplicate mappings and an existing opening fail closed. The server records one
opening atomically and retries use the original idempotency key. The opening is
shown separately from current-period cash movement, never as a sales receipt.
Reconciliation periods must start after its cutover date; do not invent a statement
transaction to match the opening. Corrections use a linked manual reversal in
Accounting, preserving the original history. A second opening is not allowed after
reversal; an accountant reviews any replacement adjustment.

## Recoverable account removal

Select **All locations** in Working location, then select the bank account and
choose **Delete or archive account → Review account removal**. Review the result,
enter a reason and confirm the specific action:

- An account with no financial dependencies can be deleted recoverably.
- An account with a journal, statement, reconciliation, pending sales order,
  referenced transaction, financial audit evidence or recorded opening evidence
  is archived instead. Large or uncertain dependency
  sets are never treated as proof that the account is unused.
- Both actions stop new receipts, payments and company transfers. Neither action
  deletes financial evidence, the bank identifier, its ledger mapping or its reserved
  ledger code. Archived accounts retain statement-import and reconciliation access.
- Enable **Show archived / deleted accounts**, select the account, and use
  **Restore account** with a reviewed reason to make it available again.

Mutations recheck the server state and retain their audit trail. An uncertain result
must be checked with **Retry saved bank instructions** before starting another
instruction. Changes in the selected account do not change the saved retry.

## Correct existing bank details

With `banking.manage` access, choose **All locations**, select the active bank
account in **Banking**, then choose **Bank account details → Edit bank details**.
Correct only its bank name, account name or last four digits and save. The
existing account identifier, owner, ledger code, opening reference and financial
history are retained. This action does not move money or alter bank balances.
Create a separate account instead when the real bank account itself is different.
Archived or removed accounts must be restored through the existing reviewed flow
before editing. If a save result is uncertain, refresh and inspect the saved
account before retrying; the form blocks repeat submission until a successful
workspace refresh.

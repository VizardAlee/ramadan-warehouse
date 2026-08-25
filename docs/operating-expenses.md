# Operating expenses and controlled disbursements

Operating expenses are non-inventory costs such as electricity, rent,
professional fees, repairs, communications, and office costs. They are kept
separate from product purchase orders and transfer logistics costs.

## Workflow

1. An authorized branch manager, warehouse manager, operations administrator,
   finance officer, or system administrator records a draft expense.
2. The category is entered in the expense form. An existing category is reused;
   a new organization category and code are created automatically.
3. The draft is allocated to a branch, warehouse, or the whole organization.
   Scoped managers can use only their assigned operating context.
4. Submission freezes the evidence for review. A different authorized user
   approves the expense; the creator cannot approve it.
5. Approval posts the operating expense, separate input VAT, and accrued
   expense payable. It does not claim that money has left a bank or till.
6. Finance records each real disbursement separately. Partial payments are
   allowed, overpayment is rejected, and non-cash methods require an external
   reference.

## Invariants

- Amounts are integer kobo in storage and naira with two decimal places in UI.
- `gross = net + VAT` and every journal balances before it is committed.
- One payee/document-number combination can be recorded only once per
  organization when a document number is supplied.
- Draft creation, approval, and payment are separate server permissions.
- The expense creator cannot approve the same expense.
- `payment amount <= outstanding amount`; rejected overpayment changes nothing.
- Approval and payment add immutable journal/audit evidence rather than editing
  an earlier transaction into a different business event.
- Firestore clients have no direct write access to categories, expenses,
  payments, journals, counters, uniqueness locks, or audit records.

## Accounting mapping

| Event | Debit | Credit |
| --- | --- | --- |
| Expense approval | `6000 Operating expenses`, `1300 Input VAT` | `2100 Accrued operating expenses` |
| Expense payment | `2100 Accrued operating expenses` | settlement account `1010`, `1020`, or `1030` |

This first controlled expense phase uses one system operating-expense account
with analytic category, branch, and warehouse dimensions. It does not yet
provide a configurable chart-of-accounts editor, bank-statement reconciliation,
period locking, or complete financial statements.

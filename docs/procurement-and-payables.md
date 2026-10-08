# Procurement and accounts payable

This phase connects supplier purchasing to the existing immutable inventory
ledger and to an auditable supplier subledger. It does not treat a purchase
order, a physical receipt, a supplier invoice, and a payment as the same event.

## Workflow

1. An authorized user creates or updates an organization supplier record.
2. An authorized manager creates a purchase order for one operational location
   (Head Office or another store) and one of its stock
   locations. Product identity, SKU, tracking policy, ordered unit cost, and
   VAT are snapshotted on each line.
3. The creator submits the order. An assigned manager may approve
   their own order immediately; the decision and actor are retained in audit.
4. Assigned staff record physical receipts only against an approved order.
   Each receipt posts through the existing inventory transaction service and
   increases the destination location balance at the PO cost. Serial or lot
   evidence is required when the product tracking policy requires it.
5. A location manager or finance user matches a supplier invoice only to
   quantities already received and not already invoiced. An assigned warehouse
   manager may approve and pay their own matched invoice. A non-manager finance
   creator still needs another authorized approver.
6. Approval posts the inventory/input-VAT debit and Accounts Payable credit,
   and creates the supplier-account debit balance. Later payment creates its
   own supplier-account entry and balanced settlement journal; it never edits
   the approved invoice or physical receipt.

## Quantity and financial invariants

- `received quantity <= approved ordered quantity` for every PO item.
- `invoiced quantity <= received quantity` for every PO item.
- Repeating the same goods-receipt operation ID does not post stock twice.
- A rejected over-receipt leaves inventory and PO quantities unchanged.
- Purchase-order approval, supplier-invoice approval, and payment authority are
  separate permissions. Managers may exercise all three within server-validated
  assignments, and each action remains separately auditable.
- Money is stored as integer kobo. UI amounts are entered and displayed in
  naira with exactly two decimal places.
- Invoice totals are `net + VAT = gross`; invoice approval debits inventory and
  input VAT and credits Accounts Payable by the same gross amount.
- Supplier payments cannot exceed the approved invoice outstanding balance.
  Partial payments are supported by the payment dialog and backend, and payment allocations and
  journals must balance before commit.
- Firestore clients cannot directly mutate purchasing, receipt, supplier
  invoice, payment, supplier-account, journal, or inventory records.

## Accounting mapping

| Event                     | Debit                                 | Credit                                         |
| ------------------------- | ------------------------------------- | ---------------------------------------------- |
| Approved supplier invoice | `1200 Inventory` and `1300 Input VAT` | `2000 Accounts Payable`                        |
| Supplier payment          | `2000 Accounts Payable`               | cash `1010` or the explicitly selected company settlement account |
| Supplier advance          | `1250 Supplier advances and credits` | cash or the explicitly selected company settlement account |
| Advance applied to invoice | `2000 Accounts Payable`             | `1250 Supplier advances and credits` |

These are controlled system account codes, not user-entered posting accounts.
External bank or terminal settlement is not inferred from a recorded method or
reference.

## Scope and current boundary

Managers can complete purchasing, receipt, invoice, approval, and payment for
their assigned operating location when their combined roles grant those
permissions. Officers only receive approved goods. Finance users operate
organization-wide but retain separation when approving their own entries.
Auditors are read-only. System administrators retain organization-wide access.

New purchase orders persist canonical `operationalLocationType`,
`operationalLocationId`, and `operationalLocationName` fields alongside the
existing optional `branchId` or historical `warehouseId`. Existing warehouse
purchase orders require no destructive migration: read paths retain their
historical warehouse fields, while the UI creates new orders only for Head
Office/stores using branch ownership.

## Advances and statement controls

Record advances separately from invoice payments. Unused advances are an asset,
not a negative payable. Applying an advance requires an approved outstanding
invoice and consumes the unused advance atomically; it does not record money
leaving the company again. Duplicate retries and concurrent applications are
guarded by the existing idempotency record, invoice and supplier transactions.
The selected funding/recording store is retained in the payment and journal.
Advances also retain a transactional per-location balance projection. Invoice
settlement must use the invoice's recording store, and advance application can
consume only that store's advance. Cross-store credit movement is not silently
inferred; an explicit transfer workflow remains future work. This prevents branch
statements from clearing one store's payable against another store's advance.

Statements use Nigerian business dates, bounded cursor pages (25/50/100), and
server aggregates for full-period opening/closing payable and advance balances.
The two aggregates must remain separate: older invoice/payment entries have no
advance field and must not be excluded from payable totals. Historical entries
are not rewritten to introduce that field. Store-filtered history excludes old
unscoped payments, which remain visible in the consolidated view. Missing
historical allocations are not guessed. CSV export is explicitly page-only.
Inactive suppliers remain selectable for history and existing invoice settlement;
they cannot receive new advances or be selected for new purchase orders.

Interrupted payment requests retain their exact payload/idempotency key for a
same-transaction retry and lock inputs until the outcome is known. After closing
or refreshing, inspect history before initiating another payment.

Still pending in this workstream: payable aging, supplier return/refund/credit
settlement with stock and accounting linkage, and richer GRN printout. Existing
expenses, bank reconciliation, period close and draft financial statements are
separate modules; this change does not replace them.

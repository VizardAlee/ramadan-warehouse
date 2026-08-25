# Procurement and accounts payable

This phase connects supplier purchasing to the existing immutable inventory
ledger and to an auditable supplier subledger. It does not treat a purchase
order, a physical receipt, a supplier invoice, and a payment as the same event.

## Workflow

1. An authorized user creates or updates an organization supplier record.
2. A warehouse user creates a purchase order for one warehouse and one of its
   receiving locations. Product identity, SKU, tracking policy, ordered unit
   cost, and VAT are snapshotted on each line.
3. The creator submits the order. A different authorized person approves it.
   Creator self-approval is rejected by the server.
4. Warehouse staff record physical receipts only against an approved order.
   Each receipt posts through the existing inventory transaction service and
   increases the destination location balance at the PO cost. Serial or lot
   evidence is required when the product tracking policy requires it.
5. Finance matches a supplier invoice only to quantities that have already
   been received and have not already been invoiced. A different authorized
   person approves the invoice.
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
  separate permissions. PO and invoice creator self-approval is prohibited.
- Money is stored as integer kobo. UI amounts are entered and displayed in
  naira with exactly two decimal places.
- Invoice totals are `net + VAT = gross`; invoice approval debits inventory and
  input VAT and credits Accounts Payable by the same gross amount.
- Supplier payments cannot exceed the approved invoice outstanding balance.
  Partial payments are supported by the backend, and payment allocations and
  journals must balance before commit.
- Firestore clients cannot directly mutate purchasing, receipt, supplier
  invoice, payment, supplier-account, journal, or inventory records.

## Accounting mapping

| Event | Debit | Credit |
| --- | --- | --- |
| Approved supplier invoice | `1200 Inventory` and `1300 Input VAT` | `2000 Accounts Payable` |
| Supplier payment | `2000 Accounts Payable` | settlement account (`1010`, `1020`, or `1030`) |

These are controlled system account codes, not user-entered posting accounts.
External bank or terminal settlement is not inferred from a recorded method or
reference.

## Scope and current boundary

Warehouse managers and officers receive only into assigned warehouses.
Finance users can match invoices, approve them subject to maker-checker, and
record payments organization-wide. Auditors have read-only procurement and
payables visibility. System administrators retain organization-wide access.

This phase does not yet add operating-expense bills, bank-statement import and
reconciliation, accounting-period close, or complete financial statements.
Those remain separate controlled finance phases.

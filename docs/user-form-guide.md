# User form guide

The UI explains the immediate purpose beside sensitive fields; this guide is
the longer operational reference. Values marked optional may be left blank.
Never invent quantities, costs, payment references, or approvals.

The application also provides an in-app visual guide at **User guide** in the
main navigation and at `/guide`. The Transfers register includes a focused
first-time explainer with a direct link to the Picking queue.

## Product form

- **Name, brand, model and unit** identify what the business buys, stores and
  sells. Enter the information once here; inventory forms reuse the product.
- **SKU** may be left blank for automatic generation or replaced with an
  existing business SKU.
- **Category** accepts an existing category name or a new name. A new category
  is created automatically with the product.
- **Tracking** is quantity, lot, or serial. It cannot change after ledger
  activity begins.
- **Default unit cost (₦)** is the normal acquisition cost and uses two decimal
  places for kobo. Opening stock may use an actual historical cost instead.
- **Central base selling price (₦)** is the net price before VAT established by
  central warehouse management. A branch may mark it up. A lower branch price
  requires system-administrator approval.
- **VAT rate** is entered as a percentage and appears separately on POS totals
  and receipts.

## Opening stock form

Opening stock accounts for goods the existing business already holds. It works
for both warehouse locations and store/branch stock locations.

1. Select whether the stock is at a **warehouse** or **store / branch**, then
   select its actual stock location.
2. Select the existing product. Its SKU, name, tracking policy, and configured
   default cost are reused; do not re-enter catalogue details.
3. Enter the quantity physically counted at that location and confirm or adjust
   the actual unit cost in naira.
4. Supply serial numbers or lot details only when the product tracking policy
   requires them.
5. Review and post once. Opening stock creates immutable ledger evidence and is
   not a transfer from the central warehouse.

## Warehouse-to-branch transfers

1. Create a transfer from an approved branch request or as an authorized direct
   allocation, then submit it for review.
2. A different authorized person approves it. Approval confirms the plan but
   does not move stock.
3. Reserve the approved quantity. Reservation locks available warehouse stock
   to the transfer but does not mean the goods have been collected or sent.
4. Open the **Picking queue**, physically collect the reserved goods, and
   verify the picked quantities.
5. Pack the picked goods for the named destination and independently verify the
   package.
6. Confirm dispatch only when the goods physically leave the warehouse.
   Confirmed dispatched quantities are immutable.
7. At the destination store/branch, record the quantities received, damaged,
   or missing. Do not record a receipt before the goods arrive.
8. Resolve discrepancies and transfer costs, validate the movement, and close
   the transfer. Closing a transfer does not silently cancel any remaining
   approved demand on its originating branch request.

## Branch POS

1. An administrator chooses a selling branch; a branch-scoped cashier sees only
   the assigned branch.
2. Open a device shift online and enter the cash physically present in the
   till. This is not sales revenue; it is the reconciliation starting point.
3. Search or tap products. Only products with central prices and available
   branch stock are sale-ready.
4. Review product subtotal, VAT, and gross total separately.
5. Select cash, card/POS terminal, or bank transfer and optionally record the
   external reference. The app records the method but does not claim a bank or
   terminal has settled it.
6. Complete the sale. Online, all records post together. Offline, issue the
   visibly provisional receipt and keep the browser/device data intact until
   synchronization succeeds.
7. Resolve every offline review item before closing the shift, count the cash,
   and enter the closing amount for variance recording.

## Customer and credit forms

1. Create the customer once with a name and either an 11-digit Nigerian phone
   number beginning with `0` or an email address. The generated customer number
   is reused on sales, receipts, payments, and account entries.
2. Creating a customer does **not** approve credit. A system administrator must
   open **Credit decision**, choose approve, enter the limit in naira, and give
   a meaningful reason. Suspending or rejecting credit blocks new borrowing but
   never erases an existing balance.
3. At POS, choose **Approved customer credit** and select the customer. The app
   shows current available credit and performs a live server check before it
   posts stock, VAT, receipt, and Accounts Receivable together. Credit cannot
   be used offline.
4. When money is received later, use **Record payment** on the customer. Select
   the receiving branch, actual method, amount, and external reference where
   applicable. The payment reduces the receivable and creates its own journal;
   it does not rewrite the original sale.

## Returns, refunds, and exchanges

1. Open **Returns** for the selling branch and enter the receipt number. The
   app loads the original products, prices, VAT, and remaining returnable
   quantities; do not re-enter catalogue or price information.
2. Enter only the quantity physically returned. Choose **Restockable** only
   after confirming the item can be sold again; choose **Damaged / do not
   restock** when branch saleable stock must remain unchanged.
3. Choose the real resolution: cash, card/POS, bank transfer, reduction of the
   named customer's receivable, or exchange credit for a later POS sale. Add a
   clear reason and submit. For cash, select the open till that physically pays
   the customer; the approved refund reduces that shift's expected closing cash.
4. Submission changes nothing financially. A different authorized manager or
   finance/administrative approver reviews and posts it. The app rejects
   creator self-approval and quantities already returned on another approval.
5. For an exchange, open a new online POS sale and select the active exchange
   credit. Its balance is applied first and any sale remainder is recorded as
   cash. The credit is checked and consumed atomically; it cannot be used
   offline or reused after exhaustion.

## Suppliers and purchasing

### Supplier form

- Enter the supplier's business name once. Code may be left blank when the form
  offers generation; use an existing supplier code only when it is genuinely
  part of the business records.
- Phone, email, tax number, and address identify the supplier; they do not
  approve a purchase, invoice, or payment.

### Purchase order

1. Select the receiving **warehouse** and its physical stock location. A branch
   is not a warehouse and cannot be selected as the PO destination.
2. Select the supplier and existing products. Product name, SKU, and tracking
   policy are reused; enter only ordered quantity, agreed unit cost in naira,
   and applicable VAT.
3. Create the draft, review it, then submit it. A different authorized user
   approves it. Approval does not add stock and does not create a payable.

### Receive purchase order

1. Open an approved order and select the product line physically delivered.
2. Enter only the quantity actually counted. The destination, product, unit
   cost, and VAT come from the PO and are not re-entered.
3. Enter serial numbers or batch evidence only when required by the product.
   Posting increases warehouse stock and cannot exceed the approved quantity.

### Supplier invoice and payment

1. Match the supplier's invoice to received, not-yet-invoiced PO quantities.
   Enter the supplier invoice number and date from the actual document.
2. Submit the match. A different authorized approver confirms it; this is when
   the Accounts Payable balance and accounting journal are posted.
3. Record a payment only when money is genuinely disbursed. Enter the amount in
   naira, actual method, and external reference. Partial payment is allowed by
   the accounting service; never claim bank settlement merely because a
   reference was recorded.

## Operating expenses

1. Open **Expenses** and type the category, such as Electricity or Repairs.
   Existing categories are suggested; typing a new category creates it
   automatically, so no separate setup form is required.
2. Enter the actual payee, expense date, description, and optional supplier
   invoice or receipt number. Allocate it to the whole organization, one store
   / branch, or one warehouse. A scoped manager sees only assigned locations.
3. Enter the net amount and VAT separately in naira. Kobo uses two decimal
   places. Do not enter product purchases here; those belong to Purchasing.
4. Create and review the draft, then submit it. A different authorized user
   approves it. Submission and approval do not claim the bill was paid.
5. Finance records each real payment using its actual method, amount, and
   external reference. Partial payment is supported. The app rejects any
   amount above the remaining outstanding balance.

## Bank reconciliation

1. Open **Banking** and add the real bank account once. Enter only its last four
   digits; the full account number is neither required nor stored. Keep `1030`
   for the existing bank-transfer clearing account. Each additional bank account
   needs its own unused 10xx ledger code.
2. Select the bank account and paste statement rows in the displayed order:
   `date, description, amount, reference, bank ID`. Use a positive amount for
   money received and a negative amount for money paid. Amounts are naira with
   up to two decimal places. Reference and bank ID are optional.
3. Match each row to an equal ledger line. The app proposes only equal debit or
   credit amounts and rejects dates more than 31 days apart. If a match is wrong,
   remove it before closing the period.
4. Enter the statement period and its exact opening and closing balances. The
   app will not prepare the reconciliation while either side has an unmatched
   transaction or the difference is not exactly zero.
5. A different authorized administrator or finance officer completes the
   prepared reconciliation. Closed matches cannot be removed; corrections must
   use new accounting evidence rather than rewriting the closed period.

## Monthly accounting close

1. Complete sales, returns, purchasing invoices, expenses, payments, POS-shift
   closure, and bank reconciliation for the ended month.
2. Open **Month close**, select that month, and review every readiness message
   plus the debit/credit trial balance. Resolve every blocker in its source
   workflow; do not work around it with direct database edits.
3. An authorized finance officer or administrator selects **Prepare month**.
   This locks journal posting dated in that month.
4. A different authorized finance officer or administrator selects **Complete
   independently**. The app rechecks the evidence before recording the close.
5. If a historical correction is later required, record an authorized
   correcting transaction in an open month. Never alter closed evidence.

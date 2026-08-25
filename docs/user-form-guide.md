# User form guide

The UI explains the immediate purpose beside sensitive fields; this guide is
the longer operational reference. Values marked optional may be left blank.
Never invent quantities, costs, payment references, or approvals.

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

# User form guide

The UI explains the immediate purpose beside sensitive fields; this guide is
the longer operational reference. Values marked optional may be left blank.
Never invent quantities, costs, payment references, or approvals.

The application also provides an in-app visual guide at **User guide** in the
main navigation and at `/guide`. It starts with role-aware task cards and a
three-step stock-transfer explainer. Earlier transfers retain a separate detailed
logistics guide; the Picking queue is not the normal starting point for new transfers.

## Stores and head office

Create every selling location as a **store / branch**. Designate one active
branch as **Head office / central distribution** when the head office both
sells to customers and supplies other stores. The designation does not move or
rewrite existing stock. Historical warehouse records remain available for
audit and must be cleared through recorded stock movements rather than deletion.
Purchasing records that already point to a warehouse continue to use that
legacy facility during the transition. Do not delete it or relabel historical
purchase and ledger evidence; move balances through audited workflows before
retiring the legacy record.

## Request stock and confirm arrival

Select **From**, **To**, **Product**, and **Quantity**, then choose **Create transfer**. The sending location can be a warehouse or another branch. The receiver must be a different branch. A manager responsible for the source reviews quantities and chooses serial numbers when required, then taps **Confirm transfer and hold stock**; the creator may do this immediately when they manage the source. Once goods arrive, the receiving manager opens **Action required**, counts them, and taps **Confirm goods received**. Choose **Some items are missing or damaged** to enter the actual quantities separately. Do not invent delivery, package or transport information. See [Simple stock transfers](simple-stock-transfers.md).

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

### Import product catalogue

1. Open **Products** and select **Import catalogue**. Upload a UTF-8 CSV or
   Excel `.xlsx` file whose first row contains column headings.
2. Review the automatic column matches. For a different heading such as
   `Item Description`, select the corresponding system field from the mapping
   control. One imported column cannot supply two system fields.
3. Product name is required. Map unit and tracking columns when your file has
   them, or use the import defaults. SKU may be unmapped or blank for automatic
   generation. Category names are reused or created automatically.
4. Costs and central prices use naira with two decimal places for kobo. VAT is
   mapped separately as a percentage.
5. To import existing stock at the same time, map **Opening quantity**, choose
   the store where the goods are held, and include unit cost. For serialized
   products also map serial numbers separated by `|`; for batch-tracked goods
   map a lot number. Only users allowed to post opening stock can do this.
   Use a separate file for each store.
6. Review the mapped sample, select **Validate rows**, and correct every
   reported row/field error in the source file. Nothing is created during
   preview.
7. Select **Import validated products** once validation passes. The confirmed
   import is idempotent, enforces SKU uniqueness and permissions, and records
   audit evidence.

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
4. Open the transfer from the **Picking queue** and use the guided workspace to
   record the goods physically collected.
5. Choose **Pack and seal**. A normal transfer does not require another user to
   repeat the warehouse preparation.
6. Enter the driver and any available vehicle or waybill details, then choose
   **Confirm dispatch** when the goods physically leave the warehouse. The same
   assigned warehouse operator may complete steps 4–6.
   Confirmed dispatched quantities are immutable.
7. At the destination store/branch, confirm a complete good-condition receipt
   or record quantities received, damaged, or missing. Optional independent
   checks remain available for exceptional or high-risk movements. Do not
   record a receipt before the goods arrive.
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
4. If a customer is not ready to pay, choose **Hold sale & start new**. The
   basket and checkout choices remain on that cashier's device while a clean
   transaction opens. Choose **Resume sale** when the customer returns. A held
   sale does not reserve stock; current prices and available quantities are
   checked when it is resumed. Delete abandoned held sales from the same list.
5. If needed, enter the discount in naira and a short business reason. The
   discount reduces the product subtotal before VAT is calculated and remains
   visible on the invoice, sales report, and audit trail.
6. Choose **Walk-in customer** only for an anonymous sale. Select an existing
   customer for named cash, card, transfer, or credit sales; use **Add customer**
   if the record does not exist yet.
7. Review product subtotal, discount, net sales, VAT, and invoice total
   separately.
8. Select cash, card/POS terminal, or bank transfer and optionally record the
   external reference. The app records the method but does not claim a bank or
   terminal has settled it.
9. Choose **Receive order**. This records the basket but does not yet reduce
   stock. A cashier then chooses **Accept payment** using an open shift.
10. An authorized manager chooses **Confirm payment & release goods**. This is
   the only step that reduces stock and posts the official invoice, receipt,
   VAT, settlement, and accounting records. A user with multiple roles may
   perform every action those roles allow; another person is not artificially
   required.
11. Offline, the device can capture and queue the order. Do not release goods
   against an offline provisional reference: reconnect, synchronize, accept
   payment, and complete confirmation first.
12. Resolve every offline review item before closing the shift, count the cash,
   and enter the closing amount for variance recording.

The printed invoice shows **Credit issued at checkout**, the original unpaid
amount at issue. Later repayments do not rewrite that historical amount. Use the
customer statement and verified invoice allocations for current debt.

## Customer and credit forms

1. Create the customer once with a name and either an 11-digit Nigerian phone
   number beginning with `0` or an email address. The generated customer number
   is reused on sales, receipts, payments, and account entries.
2. Creating a customer does **not** approve credit. A system administrator must
   open **Credit decision**, choose approve, enter the limit in naira, and give
   a meaningful reason. Suspending or rejecting credit blocks new borrowing but
   never erases an existing balance.
3. At POS, select the named customer and choose **Approved customer credit**.
   Enter zero for a fully-credit sale, or enter the cash/card/bank amount being
   paid now for a part-paid sale. The screen shows the balance moving to the
   customer account and checks the approved available credit live before it
   posts stock, VAT, receipt, settlement, and Accounts Receivable together.
   Credit cannot be used offline.
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


## Customer account statement

Open **Customers → full history → Account statement**. Select **From / To**
dates, a store, and a named arrangement or **All arrangements**. Each movement
appears once. **Debt balance** and **Advance balance** show independent running
balances after each transaction; unused advances are not subtracted from debt.
**Opening recorded balance** and **Closing recorded balance** describe the
selected period and entry scope. Current balance cards remain across all stores.
For example, a ₦10,000 credit invoice followed by a ₦4,000 allocated repayment
leaves ₦6,000 debt; an unused advance remains separately visible.

Choose **Print / Save complete statement** or **Export complete statement** to
retrieve every page and include opening, chronological movements and closing
balances. More than 10,000 entries requires a shorter range. **Needs review**
means historical evidence or classifications require reconciliation. Never treat
unknown balances as zero or claim a reconciled account from those records.
A concurrent change may require refreshing and retrying the export.

## Reporting tools

This update adds product margin reports, full-range HR history and multi-month
budget comparisons alongside the existing customer account statement. Mixed
billing software does not create or select production ledger accounts. An
authorized accountant must review and configure dedicated controls before
service billing can post.

### Product sales and recorded gross margins

1. Open **Reports → Sales register** and set dates and store. Existing **Daily**,
   **Weekly**, **Monthly** and **Custom** ranges are available. **All sales summary**
   and **Credit sales summary** already report full-range sales; original credit
   issued is different from remaining debt after repayments and returns.
2. With both sales-report and inventory-cost access, choose **Calculate product
   margins**. This includes all payment statuses and invoices issued in the range.
3. Review **Net sales**, **Recorded cost**, **Restock credits**, **Gross margin**
   and **Cost evidence**. Returns and collections belong to those invoices and
   can have happened after the selected dates. This is an invoice-cohort view,
   not a posted-period profit and loss statement. Net sales exclude VAT; costs
   exclude overhead and operating expenses. For period profit use **Financial
   statements**.
4. **Unknown** means missing costs, pending collection or held-return recovery
   requiring further allocation. Explicit recorded zero cost differs from missing
   cost. Approved restock returns credit cost; damaged returns do not automatically
   restore inventory or clear cost. Unapproved returns do not change this report.
5. Choose **Export product CSV** for all returned product totals. More than 2,000
   products requires a smaller range; no partial totals are presented as complete.

### Attendance and staff activity history

1. Open **HR & attendance → Attendance and staff activity history**. HR read
   permission is required; salary permission remains separate.
2. Choose **Attendance** or **Staff activity**, **From**, **To**, and **Rows**.
   Dates use Nigerian business time. For example September 1–30 includes all
   recorded events in those dates, including the final instant of September 30.
3. Use **Next / Previous** for older records. This extends the existing recent
   25-event previews; employee names are resolved even outside the staff page.
4. Choose **Export full range CSV** for every page in that range. Ranges above
   10,000 events require narrowing; no truncated file is exported. Refresh and
   retry if history changes during export.
5. These reports show recorded events only. They do not infer worked hours,
   lateness, overtime, attendance approvals or payroll entitlements.

### Compare monthly budgets

1. Open **Finance → Budgets versus actuals → Compare monthly budgets**.
   Finance journal read access is required. Existing target changes still require
   budget management permission, a reason and a recorded revision.
2. Set **From month / To month** to a range of up to 12 months and choose
   **Compare months**. Actuals come from posted journals using Nigerian calendar
   months. Store and organization targets remain distinct; they are not added
   together.
3. Review each saved account target against its actuals. For example a ₦100,000
   income target with ₦120,000 recorded income has ₦20,000 favorable variance.
   For expenses, spending below target is favorable. Missing targets are labelled
   **no saved targets**, not invented as zero. Comparisons do not post journals.
4. Choose **Export comparison CSV** to export all comparison rows. Department
   allocations and payroll budgets have not been introduced by this extension.


## Mixed goods and service invoices

1. Complete this **one-time setup before the first mixed goods/service
   transaction**. Ask an authorized accountant or system administrator with
   account-management permission (`finance.accounts.manage`) and organization-wide
   sales/accounting access (`sales.read.all`) to review and save the mappings.

   Open **Money & accounts → Accounting**. In **Company ledger accounts**, create
   and review two distinct, active, dedicated NGN liability accounts if needed.
   Your accountant chooses the account codes; accounts with unrelated posting
   history cannot be repurposed as billing controls.

   Open **Mixed billing account controls**. Select the reviewed service-deferral
   account under **Deferred service control** and the separate provider-payable
   account under **Provider funds payable**. Enter a **Review reason**, then click
   **Save reviewed account mappings**.

   Afterwards, eligible new mixed invoices use the mappings automatically; **no
   per-sale configuration is needed**. Prior invoices retain their saved account
   mappings. Revisions are audited and those controls remain protected from
   manual account changes and journals. Missing or inactive required mappings
   block posting. Customer advances keep their existing account.
2. In online **POS**, add catalogue services alongside goods. Expand **Service
   billing details**. Add separately charged parts as normal goods in the basket.
   Use **Physical part included in fee** only for stock consumed within the service
   price. Included parts consume stock and cost once at confirmation, even when
   other goods are reserved for later collection. Services have no collection or
   waybill quantity. Serial parts require exact owned available serials; one
   serial cannot be both charged and included.
3. Select an existing supplier under **Delivery/service provider**, enter
   **Provider funds (₦), separate from company fee**, then **Apply provider funds**.
   Use **Load more existing suppliers** for later supplier pages. Provider funds
   are a separate payable, excluded from company income and VAT; the company fee
   retains its configured VAT. Register suppliers in Purchasing using goods,
   service, logistics or mixed classification. Bank details are not required just
   to register a provider.
4. Optionally enter a compatible confirmed aftersales case ID and choose
   **Link / refresh confirmed case**. Its fixed charge, VAT and prior receipts are
   carried once. The remaining amount shown for allocation excludes those prior
   receipts. A held basket must refresh linked cases before checkout. Historical
   cases that need reconciliation cannot be silently converted. Once billed,
   use the invoice for subsequent receipts, corrections and credits; aftersales
   retains its original receipt history and service status workflow.
5. Accept and confirm payment through the existing controlled order workflow.
   Goods retain invoice recognition. Unpaid service gross remains in deferred
   service control; allocated cash/card/bank receipts and applied advances release
   the corresponding service income and VAT. Partial payments allocate minor
   units cumulatively with stable line-order rounding. Completion of service work
   alone does not release income. Later customer repayments must select invoice
   allocations. Split tenders and customer advances do not create another receipt.
6. In **Expenses → Provider funds**, select invoice dates and store, then
   **History / payment**. **Pay provider** records actual partial or full settlement
   against the payable using the company account used. **Record recovered /
   returned provider funds** requires the original settlement and reversal access.
   Neither operation recognizes another expense or income. The dates select
   invoices; current collections, credits and settlements may include later
   activity. **Export full provider CSV** reads every page, up to 10,000 obligations.
   An empty scanned page may still have a **Next** page.
7. In **Returns**, load the receipt and choose **Credit service fees / provider
   charges** to reduce a commercial charge. Select quantities and any provider
   credit, a reason, and refund, exchange credit, debt reduction or **Part refund /
   exchange credit and part debt reduction**. A split must leave a valid unpaid
   debt portion. Manager approval posts the credit; service credits require no
   physical inspection and never restock included parts. Recover settled provider
   funds before crediting that part of the obligation.
8. For a returned payment where the charge is still owed, authorized staff with
   returns approval and journal reversal access use **Correct a mixed invoice
   receipt**. Select the original actual receipt, amount, reference, reason and
   funding till/company account. **Record actual receipt refund and restore debt**
   preserves charges and creates a separate journal and customer statement debt
   movement. It reverses the corresponding service recognition and restores debt;
   it does not credit a charge or restock stock. Advances/exchange credits use
   their original non-cash workflows. Receipt selectors reject source histories
   over 200 records instead of silently hiding records. A commercial refund
   makes earlier receipt funding ambiguous: those older receipts require
   reconciliation and cannot be corrected again. Later repayments remain
   separately identifiable; they never reactivate the refunded original money.
9. If a response is interrupted, retry the saved billing instructions, including
   after reloading the same browser tab. Do not pay again or change the amount of
   an uncertain request. Store, permission, accounting-period and original account
   controls apply to every posting. No payroll or HR approval policy changes.

Product margin reports identify goods/services. Included parts form recorded
service cost once; separately billed goods keep their own cost. Provider amounts
and credits are shown separately and excluded from company margins. Service net
sales are invoice charges, not receipt-recognized period income. Use posted
financial statements for period income and VAT. Unknown cost remains unknown.

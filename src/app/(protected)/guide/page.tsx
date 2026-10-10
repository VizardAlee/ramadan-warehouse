"use client";

import Link from "next/link";
import {
  Bell,
  Boxes,
  ClipboardCheck,
  FileBarChart2,
  HeartHandshake,
  Landmark,
  PackageCheck,
  ShoppingBasket,
  ShoppingCart,
  Settings,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { useAuth } from "@/features/auth/auth-context";
import { WorkflowTrack } from "@/features/guidance/workflow-track";
import { hasAnyPermission, hasPermission } from "@/lib/permissions/roles";
import {
  detailedTransferWorkflowSteps,
  salesWorkflowSteps,
  setupWorkflowSteps,
  transferWorkflowSteps,
} from "@/features/guidance/workflows";

export default function GuidePage() {
  const { profile } = useAuth();
  const canTransfer = Boolean(profile && hasAnyPermission(profile, ["transfers.read.all", "transfers.read.assigned_warehouse", "transfers.read.own_branch"]));
  const canSell = Boolean(profile && hasPermission(profile, "sales.create"));
  const canImportProducts = Boolean(profile && hasPermission(profile, "products.create"));
  const canPurchase = Boolean(profile && hasAnyPermission(profile, ["procurement.read", "payables.read"]));
  const canReconcile = Boolean(profile && hasAnyPermission(profile, ["inventory.count", "inventory.reconcile", "sales.shift.manage", "banking.read"]));
  const canAftersales = Boolean(profile && hasPermission(profile, "sales.returns.read"));
  const canFinance = Boolean(profile && hasAnyPermission(profile, ["finance.journal.read", "banking.read", "accounting.close.read"]));
  const canHr = Boolean(profile && hasPermission(profile, "hr.read"));
  const canReport = Boolean(profile && hasAnyPermission(profile, ["reports.inventory.read", "reports.requests.read", "reports.transfers.read", "reports.sales.read", "finance.journal.read"]));
  const canAdmin = Boolean(profile && hasAnyPermission(profile, ["organization.manage", "branch.manage", "warehouse.manage", "location.manage", "user.manage", "role.manage"]));
  const canTax = Boolean(profile && hasPermission(profile, "finance.journal.read") && hasPermission(profile, "sales.read.all"));
  return (
    <div className="page-stack">
      <header>
        <p className="text-sm font-semibold uppercase tracking-wider text-emerald-800">
          Quick help
        </p>
        <h1 className="mt-2 text-3xl font-semibold">What do you want to do?</h1>
        <p className="mt-2 text-[var(--muted)]">
          Choose a task. On a computer, related pages sit together in the side menu; on a phone, use the main shortcuts or More.
        </p>
      </header>
      <nav
        aria-label="Choose a help topic"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
      >
        {canImportProducts && (
          <Link href="/products" className="rounded-2xl border bg-white p-5">
            <Boxes className="mb-3 size-7 text-emerald-800" />
            <strong>Move products from another system</strong>
            <p className="mt-2 text-sm">Choose Import catalogue, upload CSV or Excel, match columns, and optionally bring in opening quantities for one store.</p>
          </Link>
        )}
        {canTransfer && (
          <>
            <Link
              href="/transfers/create/direct"
              className="rounded-2xl border bg-white p-5"
            >
              <Boxes className="mb-3 size-7 text-emerald-800" />
              <strong>Get stock from another location</strong>
              <p className="mt-2 text-sm">
                Choose Head Office or another store. No packaging or transport
                form.
              </p>
            </Link>
            <Link href="/transfers" className="rounded-2xl border bg-white p-5">
              <PackageCheck className="mb-3 size-7 text-emerald-800" />
              <strong>Goods have arrived</strong>
              <p className="mt-2 text-sm">
                Open Action required, tap Take action, count the goods, and confirm arrival. Full details remains available for exceptions.
              </p>
            </Link>
          </>
        )}
        {canSell && (
          <Link href="/pos" className="rounded-2xl border bg-white p-5">
            <ShoppingCart className="mb-3 size-7 text-emerald-800" />
            <strong>Make a sale</strong>
            <p className="mt-2 text-sm">
              Select your store, open a shift, then add products. On a phone, use the bottom Current sale button to review the cart.
            </p>
          </Link>
        )}
        {canPurchase && (
          <Link href="#purchasing" className="rounded-2xl border bg-white p-5">
            <ShoppingBasket className="mb-3 size-7 text-emerald-800" />
            <strong>Buy and receive goods</strong>
            <p className="mt-2 text-sm">Order, receive, record supplier invoices and pay from the right company account.</p>
          </Link>
        )}
        {canReconcile && (
          <Link href="#daily-checks" className="rounded-2xl border bg-white p-5">
            <ClipboardCheck className="mb-3 size-7 text-emerald-800" />
            <strong>Check stock and money</strong>
            <p className="mt-2 text-sm">Compare physical counts, till cash and bank activity with app records.</p>
          </Link>
        )}
        {canAftersales && (
          <Link href="#after-sales" className="rounded-2xl border bg-white p-5">
            <HeartHandshake className="mb-3 size-7 text-emerald-800" />
            <strong>Handle a return or service</strong>
            <p className="mt-2 text-sm">Keep refunds and exchanges separate from warranty or paid service cases.</p>
          </Link>
        )}
        {canFinance && (
          <Link href="#finance" className="rounded-2xl border bg-white p-5">
            <Landmark className="mb-3 size-7 text-emerald-800" />
            <strong>Review company finances</strong>
            <p className="mt-2 text-sm">Find bank reconciliation, financial reports, tax evidence, budgets and month close.</p>
          </Link>
        )}
        {canHr && (
          <Link href="#people" className="rounded-2xl border bg-white p-5">
            <UsersRound className="mb-3 size-7 text-emerald-800" />
            <strong>Manage employees</strong>
            <p className="mt-2 text-sm">Record staff without app logins, attendance and HR activities.</p>
          </Link>
        )}
        {canAdmin && (
          <Link href="#setup" className="rounded-2xl border bg-white p-5">
            <Settings className="mb-3 size-7 text-emerald-800" />
            <strong>Set up stores and access</strong>
            <p className="mt-2 text-sm">
              Head Office is a selling store and the central distribution point. Manage users without deleting history.
            </p>
          </Link>
        )}
        <Link href="#alerts" className="rounded-2xl border bg-white p-5">
          <Bell className="mb-3 size-7 text-emerald-800" />
          <strong>See what needs attention</strong>
          <p className="mt-2 text-sm">Use the in-app inbox; browser push is optional on each device.</p>
        </Link>
      </nav>
      <p className="rounded-2xl border bg-white p-5 text-sm leading-6">The printed invoice shows Credit issued at checkout, the original unpaid amount at issue. Later repayments do not rewrite that historical amount. Use the customer statement and verified invoice allocations for current debt.</p>
      <section id="mixed-billing" className="space-y-3 rounded-2xl border bg-white p-5">
        <h2 className="text-xl font-semibold">Mixed goods and service billing</h2>
        <p className="text-sm leading-6">Service billing requires reviewed account mappings. In Finance → Mixed billing account controls, an accountant selects two existing reviewed, dedicated NGN liability accounts: Deferred service control and Provider funds payable, with a review reason. Revisions retain prior invoice mappings; missing or inactive mappings block dependent services. Customer advances keep their existing account.</p>
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-6">
          <li>In online POS, add catalogue services and goods together. Expand Service billing details. Separately charged parts go in the main basket. Physical part included in fee consumes stock and cost once at confirmation, even when other goods await collection. Services have no physical collection or waybill quantity. Use each owned serial once.</li>
          <li>Select an existing supplier under Delivery/service provider, enter Provider funds (₦), separate from company fee and choose Apply provider funds. Load more existing suppliers retrieves later pages. Purchasing records goods, service, logistics or mixed suppliers without mandatory bank details. Provider funds are a separate payable; the retained company fee is income.</li>
          <li>For an existing compatible confirmed service case, enter its ID and choose Link / refresh confirmed case. Its fixed charge, VAT and prior receipts carry once; the remaining amount excludes prior receipts. Refresh restored held cases before checkout. Once billed, use the invoice for later payments and credits. Aftersales still tracks work and preserves earlier receipts.</li>
          <li>Accept and confirm the order using normal payment controls. Unpaid service gross remains deferred; allocated partial cash/card/bank receipts and applied customer advances release service income and configured VAT. Goods keep invoice recognition. Later customer repayments need invoice allocations. Completing work alone does not recognize income.</li>
          <li>In Expenses → Provider funds, select invoice dates/store and History / payment. Pay provider settles the dedicated payable; Record recovered / returned provider funds links an actual recovery to its original settlement and needs reversal access. Neither creates another expense or income. Export full provider CSV reads every page up to 10,000 obligations; an empty scanned page can still have Next.</li>
          <li>In Returns, load the invoice receipt and choose Credit service fees / provider charges for a waived charge. Submit quantities/provider amounts and refund, exchange credit, debt reduction or Part refund / exchange credit and part debt reduction. Manager approval requires no service inspection and never restocks included parts. Recover settled provider funds before crediting that obligation.</li>
          <li>For a returned payment with the charge still owed, authorized staff use Correct a mixed invoice receipt, select an original receipt and funding till/account, then Record actual receipt refund and restore debt. A separate journal and statement debt movement preserve the charge. Advances and exchange credits use their original workflows. Selectors reject source histories over 200 records instead of omitting receipts. After a commercial refund, earlier receipts require reconciliation and cannot be corrected again; later identifiable repayments never reactivate original refunded money.</li>
          <li>Retry saved billing instructions after an interrupted response, including after reloading the same tab. Do not record another payment while the original is uncertain. Permissions, store scope, period locks and original invoice mappings apply throughout.</li>
        </ol>
        <p className="text-sm leading-6">Product margin reports distinguish goods/services and count included parts once in service cost. Provider charges and credits appear separately, excluded from company margins. Service net sales are invoiced charges; period income follows posted receipt recognition. Unknown cost stays unknown. A separate company expense for an existing provider obligation requires its own supplier document and an independent obligation reference. No payroll or HR policy is introduced.</p>
      </section>
      {canTransfer && <section id="transfers" className="scroll-mt-24 space-y-4">
        <WorkflowTrack
          title="Move stock in three steps"
          description="Head Office to another store, or store to store. The source manager confirms the stock and the destination manager confirms receipt. No picker, packer, driver or separate administrator is required for the normal transfer."
          steps={transferWorkflowSteps}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
            <h2 className="font-semibold">
              Example: 20 panels for Igbo Road Branch
            </h2>
            <p className="mt-2 text-sm leading-6">
              Choose the location holding the panels and request 20. The source
              manager confirms the stock. When the panels arrive, the receiving
              manager counts all 20 and taps “Confirm goods received”. The
              branch can now sell them.
            </p>
          </section>
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
            <h2 className="font-semibold">Only 18 arrived? Two are damaged?</h2>
            <p className="mt-2 text-sm leading-6">
              Choose “Some items are missing or damaged”. Enter what arrived in
              good condition and what arrived damaged. Do not count missing
              goods as received. The administrator can resolve a problem; stock
              still expected remains held.
            </p>
          </section>
        </div>
        <details className="rounded-2xl border bg-white p-5">
          <summary className="cursor-pointer font-semibold">
            I cannot see the transfer or the next button
          </summary>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6">
            <li>
              Check the location selector at the top. Receiving is done for the
              destination branch.
            </li>
            <li>
              Action required shows work you can complete. Waiting on another
              location shows work assigned elsewhere.
            </li>
            <li>
              Use Take action to confirm from the queue without leaving it; open Full details for a wider view of the same audited transfer.
            </li>
            <li>
              A source-location manager or administrator confirms the stock. The
              receiving branch manager or administrator confirms arrival.
            </li>
            <li>
              Older transfers remain under “Earlier transfers and optional
              detailed logistics”. They are not silently converted.
            </li>
            <li>
              Transfers need an internet connection. After a connection error,
              retry without changing the quantities; duplicate submissions do
              not post stock twice.
            </li>
          </ul>
        </details>
      </section>}
      {canSell && (
        <section id="sales" className="scroll-mt-24 space-y-4">
          <details className="surface p-4"><summary className="cursor-pointer font-semibold">Paid goods awaiting collection</summary><p className="mt-3 text-sm leading-6">When confirming payment, choose “reserve for later” if the customer has not taken the goods. They remain physically in the store but cannot be sold again. Choose “collect now” only when handing them over. Later, open “Goods awaiting collection” in POS, review the invoice, enter the quantities actually collected and the collector’s name, then record physical collection. Partial collection leaves the rest reserved. Optionally upload up to five JPEG/PNG photos, 2 MB each, against the products being collected. Use the device camera where supported or choose a file. Uploaded photos attach only when physical collection is recorded; view them later from the invoice collection record. Photos are private, and uploading alone never changes stock. For serial-tracked products, enter one exact serial number per unit in POS (one per line, up to 50 per order). Internet access is required. Receiving an order or holding a basket does not reserve a serial; final payment confirmation checks and allocates the units. When collecting part of an order, enter only the reserved serials actually handed over. Invoice and collection waybill records retain those serials. For cancellation, select eligible uncollected serials; for a return, select serials already collected on that sale. Returned units require inspection: only a resellable disposition restores availability; damaged or defective units remain held, not sellable. A stock-release permission is required. Collection updates stock, cost accounting and audit together and requires internet access. Old sales and offline checkout retain their existing immediate-collection behaviour.</p><p className="mt-3 text-sm leading-6">If the customer cancels before collecting, open Returns, look up the receipt and choose “Cancel goods not collected”. Enter the quantities, refund or account resolution, funding account where needed, and reason. An authorized manager with return approval and stock-release permissions posts the cancellation. The goods become available again without adding physical stock. Use “Return goods already collected” only for goods that actually left the store. Partial cancellation leaves the remaining goods reserved. Do not issue a physical refund unless the selected settlement matches how the customer is being compensated.</p></details>
          <WorkflowTrack
            title="Sell and account"
            description="Prices and product information are reused. VAT is separate; confirmed sales create controlled documents. You can type a quantity, hold a basket locally and create a customer without leaving POS."
            steps={salesWorkflowSteps}
          />
          <p className="rounded-xl border bg-white p-4 text-sm leading-6">
            In Products, authorized price administrators can set retail and optional wholesale prices. In Customers, choose Retail or Wholesale / dealer as the default price level. Selecting a customer in POS updates the basket&apos;s catalogue prices; a product without a wholesale price uses retail. You can also choose the price level beneath each basket item. An agreed sale-specific price keeps its audit reason and remains unchanged when switching levels. Review the total before receiving the order. Held baskets retain their price level; offline orders retain their snapshot and need explicit review if that catalogue version changes before synchronization. Changing a catalogue price never changes an already posted sale.
          </p>
          <p className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm leading-6">
            On a new device, use the <strong>Install app</strong> banner after signing in. Chrome or Edge may open an install prompt; iPhone, iPad and Safari show short on-screen steps instead. If you dismiss the banner, use the download icon in the top bar later. Install while connected, then open POS online once to prepare its offline cache.
          </p>
          <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
            Open POS online once on each device and store to cache its screen and stock snapshot. The installed app can then open POS and save an order with an already-open shift while offline; it synchronizes when connection returns. Opening a new shift, creating a customer and credit sales require a connection. Other sections still need a connection. A held basket is only on this device and does not reserve stock.
          </p>
          <p className="rounded-xl border bg-white p-4 text-sm leading-6">
            For a credit or part-payment sale, select a named customer in POS. A system administrator can grant credit directly without first approving that customer&apos;s credit limit; the decision, amount and administrator are audited. Other users need approved available customer credit. The customer&apos;s outstanding balance remains visible for later payment.
          </p>
          <p className="rounded-xl border bg-white p-4 text-sm leading-6">In Customers, desktop screens show a compact table and smaller screens show cards. Choose a search field and type the start of the name, customer number, phone or email. Use 25, 50 or 100 rows per page. View history expands the five most recent activities; View full history opens a separate page with store filters and pages of older transactions.</p>
          <p className="rounded-xl border bg-white p-4 text-sm leading-6">In Customers → Edit details, add named account arrangements for separate projects or trading relationships. Select the arrangement in POS. All arrangements share the customer&apos;s credit limit; old balances stay in General account. In Payment, choose a tracked unpaid invoice for full or partial repayment, or use automatic allocation: historical unallocated debt first, then the oldest tracked invoices in this store and arrangement (up to 50 per receipt). Return credits reduce the original unpaid invoice and arrangement. Full history shows unpaid invoices and aging. If a payment fails, retry in the same dialog; after closing or reloading, check history before recording it again.</p>
          <p className="rounded-xl border bg-white p-4 text-sm leading-6">Use Record advance when receiving money before a sale; select the arrangement and receiving company account. This is an advance liability, not sales revenue. In Payment, choose Apply previously received advance to reduce an existing debt without recording the cash twice. In POS, select the named customer and arrangement, then Customer advance to cover the full sale, or Split across payment methods to combine one advance component with cash, card or transfer. Only the selected arrangement’s unused advance is available; connect online and refresh balances when needed. Holding, receiving or rejecting an order does not deduct the advance. Final confirmation checks and deducts it atomically with the sale, reservation/release, journal and audit. This is not another cash/bank receipt. Returns still require their separate authorized refund or exchange-credit workflow; they do not silently restore an advance as well. Set the agreed Payment due date in POS for credit and part-payment orders, including split payments. Blank dates are explicitly undated. Due and overdue tracked invoices notify authorized payment staff through the existing bell/push delivery; old debt is never given a guessed date.</p>
          <p className="rounded-xl border bg-white p-4 text-sm leading-6">When actually paying unused advance money back, authorized customer-payment and return-approval staff use Refund advance. Select the customer arrangements, store recording the outgoing payment, amount and reason. A bank/card refund requires the paying company account and actual refund reference. Cash refunds post to the store’s cash-on-hand ledger, not a POS till shift. Advances belong to the customer across all stores; only the unused balance of each chosen arrangement can be refunded. Invoice debt, sales income and stock stay unchanged. Existing inactive customers/arrangements may still receive money owed to them. An uncertain response locks the details: retry the same refund to confirm its result, never issue a second payment. Refunds appear in customer history, audit and balanced journals. This is separate from returning goods or refunding exchange credit.</p>
          <p className="rounded-xl border bg-white p-4 text-sm leading-6">In Customers → full history, choose Account statement, select an arrangement or All arrangements, and set From / To dates and the store. Each movement appears once. Debt balance and Advance balance run separately after each transaction; Opening recorded balance and Closing recorded balance cover the selected dates and entry scope. The current-balance cards above remain across all stores. For example, a ₦10,000 credit invoice adds debt; a ₦4,000 allocated repayment leaves ₦6,000 debt, while a separate unused advance stays in its own balance. Use Print / Save complete statement or Export complete statement to collect every page in chronological order, including opening and closing balances. More than 10,000 entries requires a shorter range. Needs review means historical evidence or classification needs reconciliation; do not replace it with zero or treat the statement as reconciled. Cash sales without account movements remain in Activity, mixed receipts show the selected arrangement&apos;s portion, and old unassigned entries stay in General.</p>
          <p className="rounded-xl border bg-white p-4 text-sm leading-6">For bank/card customer repayments, choose the receiving company account. For bank/card refunds in Returns, choose the company account paying the refund. Cash refunds still require an open till. POS, supplier, expense and aftersales payments also identify the company account used. Configure accounts in Banking; the selected account is recorded with the payment and balanced accounting journal.</p>
          <p className="rounded-xl border bg-white p-4 text-sm leading-6">
            To take cash, card and bank transfer on one sale, choose Split across payment methods and enter each amount. Card and transfer lines need the receiving company account. Select a named customer and enable customer credit only when an unpaid balance is intended. An unposted order can be rejected from Awaiting action with a reason; return or reverse any money physically collected first and include its reference. A completed sale needs the Returns workflow instead.
          </p>
          <p className="rounded-xl border bg-white p-4 text-sm leading-6">
            To use exchange credit, submit the original return, record its physical inspection, then approve it with Exchange credit as the resolution. Start a new sale in the same store, select the original named customer where applicable, choose Exchange credit and select the issued credit. A more expensive replacement requires the difference as payment; the quick exchange option uses cash, while the payment-recording stage supports other configured methods. For a cheaper replacement, confirm the replacement sale first, then open Returns → Posted returns and exchange credits. Keep the remaining credit for later or record an actual refund using its funding company account or open till. The refund clears only unused credit; it does not reverse VAT or stock a second time. Exchange credits and refunds require an online connection.
          </p>
          <p className="rounded-xl border bg-white p-4 text-sm leading-6">Use New sale, Awaiting action and Held sales at the top of POS to jump between tasks. On smaller screens, tap Current sale above the bottom menu to open the cart; your basket stays in place while you browse.</p>
          <details className="rounded-xl border bg-white p-4"><summary className="cursor-pointer font-semibold">Correct a posted order: full return and reissue</summary><p className="mt-3 text-sm leading-6">Open Returns, load the original receipt and expand Posted-order corrections. Propose the replacement customer, products, quantities, unit prices and discount, with a reason and settlement instructions. Submit for an authorized review. Approval changes no money or stock and does not mean the correction is complete.</p><p className="mt-3 text-sm leading-6">After approval, process the actual goods return with inspection, or cancel goods not collected, using the existing return workflow. Create the matching replacement in POS; use valid exchange credit and any genuine payment/refund difference. In the approved correction, enter the posted return/cancellation numbers and replacement sale number, then Verify linked transactions and complete. The system checks the full original reversal, matching replacement and posted balanced journals before linking the evidence. Original invoices and ledger history remain unchanged.</p><p className="mt-3 text-sm leading-6">Never record a fictitious goods return to correct paperwork. Payment-only, serial/delivery-only amendments and standalone debit/credit notes are not supported by this full-reissue screen. Refer these to an authorized accountant. Customer-bound exchange credit cannot be transferred to a different customer; use a genuine refund and fresh payment where appropriate. These tasks require an online connection. If confirmation is interrupted, Retry same request before doing anything else.</p></details>
          <p className="rounded-xl border bg-white p-4 text-sm leading-6">After recording physical collection, open the sale document and choose View waybill beside that handover. Print the A4 waybill or save it as PDF. Each partial collection has its own waybill; it contains only the quantities actually handed over, the collector and releasing staff. Printing again keeps the same reference and never reduces stock again. Goods still reserved do not appear as released goods. Collection history shows the newest handovers first. Use Older collections or Newer collections to browse, or choose 25, 50 or 100 handovers per page. Older handovers retain their own waybill and private photo evidence. Browsing needs internet access and does not change the invoice, payments or inventory.</p>
        </section>
      )}
      {canPurchase && (
        <section id="purchasing" className="scroll-mt-24 rounded-2xl border bg-white p-5">
          <h2 className="text-xl font-semibold">Purchasing and supplier payments</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6">
            <li>In <Link className="font-semibold underline" href="/procurement">Purchasing</Link>, review existing orders first. Expand New order only when needed, then choose the supplier and receiving store. There is no separate warehouse to create.</li>
            <li>Create and approve the purchase order, then record the goods actually received. Check quantities and any tracked serials before posting.</li>
            <li>Record the supplier invoice and any outstanding payment. Choose the company account used for a bank or card payment; do not mark a bank payment as cash.</li>
            <li>For a goods-received note, choose Receiving history / GRN on the purchase order, then Open note on the relevant handover. Print / save PDF prints that recorded receipt only. Separate deliveries have separate notes; reprinting never receives stock again. Original serial/batch evidence is included where recorded. A ledger-mismatch message requires reconciliation, not another receipt.</li>
            <li>Use Record payment / apply advance on an invoice to pay all or part of its outstanding amount. Select New company payment when money leaves the company now, or Apply unused supplier advance when using money already paid. Applying an advance does not record a second cash payment.</li>
            <li>For money paid before settling an invoice, choose the supplier under Supplier accounts &amp; statements, then Record advance. Select the recording store and the company account paid from. Unused advances are shown separately from amounts owed.</li>
            <li>When a supplier actually returns unused advance money, choose Receive advance refund. Select its original recording store, enter the received amount, receiving company account/reference and refund reason. You cannot refund more than that store’s unused advance. This records money coming back, not a new payment to the supplier; invoice debt and stock do not change. Inactive suppliers can still return existing advances. This is not the goods-return workflow.</li>
            <li>For goods handed back to a supplier, open Returns &amp; credit notes on the approved supplier invoice. Choose the invoice product and its original goods-received note, enter only the quantity actually returned, exact serials if tracked, the supplier’s credit-note reference and a reason. Use Add product to credit note for a document with multiple products, then repeat for the next product. Up to 10 distinct products and 50 serials can post together; each product uses one original receipt / batch. Confirm the physical handover and supplier acceptance, then Post return &amp; credit note. Every line succeeds together or none do; each retains its stock and journal references. Full and partial quantities are supported. Already-handed-over inspected goods are settled separately without another stock deduction. You need receiving and payable-approval permissions for that store.</li>
            <li>The return updates physical stock, supplier account, original invoice balance, journal and audit together. Credit reduces unpaid invoice debt first; excess becomes supplier credit, not an assumed cash refund. Apply this credit using Apply unused supplier advance on a later invoice, or record money actually refunded through Receive advance refund with the receiving account and reference. Original invoice values and payments stay unchanged. A settled invoice may include a credit note, not just cash payment.</li>
            <li>A stock-restoring correction requires every returned unit to be inspected as resellable. Do not use it for damaged or uncertain-condition goods; arrange inspection and an authorized reconciliation instead.</li>
            <li>Use the return-history page controls to review credit notes, stock and journal references. If confirmation is interrupted, Retry same return; do not submit another note. To correct an ordinary posted supplier return, authorized receiving/payables users with stock-reversal permission choose Correct return, explain why, confirm every unit is physically back in its original store, then Reverse stock &amp; credit. This reverses one product line only, restores its stock and supplier balances together, and retains the original history with linked reversal journals. Enter a fresh return afterwards if needed. Later stock movements, consumed/refunded credit, closed periods or unverified evidence require reconciliation first. Credits for earlier custody handovers are not eligible for this stock-restoring correction. If confirmation is interrupted, Retry same correction. A stock-only reversal remains prohibited.</li>
            <li>Supplier invoice payments stay in the invoice’s recording store. Only advances or return credits recorded for that store can be applied; credit from another store must not be silently moved between accounts.</li>
            <li>Filter the supplier statement by dates and use page controls for older entries. Totals cover the full selected period; Export this page exports only visible entries. Older payments without a store are visible in the consolidated view, not store-filtered history.</li>
            <li>Enter the supplier invoice date and, when known, its payment due date. Supplier accounts show current unpaid invoices and debt aging: Current, 1–30, 31–60, 61–90 and 90+ days overdue. Due date not set means an older invoice has no recorded due date; it does not mean overdue. Use the unpaid invoice page controls to find older invoices and pay or apply advances directly from a row. Statement date filters do not change this current debt summary.</li>
            <li>If a payment connection is interrupted, use Retry same transaction. Do not create another payment until its result is known. After closing or refreshing the page, check the supplier history before recording the money again.</li>
          </ol>
        </section>
      )}
      {canReconcile && (
        <section id="daily-checks" className="scroll-mt-24 rounded-2xl border bg-white p-5">
          <h2 className="text-xl font-semibold">Daily checks</h2>
          <p className="mt-2 text-sm leading-6">Open <Link className="font-semibold underline" href="/daily-reconciliation">Daily checks</Link> to count shelf stock, check ledger balances, close the POS shift with actual till cash, and match bank entries. Record the reason for a variance; counts do not silently overwrite stock.</p>
          <p className="mt-2 text-sm leading-6">In Store daily close, choose the store and Nigerian business date, review ledger-derived opening cash, receipts, payments and expected cash, then enter the physical cash counted. Explain any variance or incomplete stock/till checks before preparing. An authorized manager or finance user can sign the prepared revision; a manager with both permissions can do both. This records evidence, not a cash adjustment or an accounting lock. Later postings or changed checks require a new revision, while earlier evidence and sign-offs remain on record. Company-wide cash without a store allocation is not included in a store close; bank reconciliation remains a separate control.</p>
          <p className="mt-2 text-sm leading-6">Stock-count variances create linked, balanced accounting entries using recorded stock cost. Authorized managers can review and post without a second person, with an audit trail. If posting is interrupted, retry the same count with its original reason; do not create another count. Closed accounting periods block stock corrections. Use the authorized reversal workflow for posted mistakes, never overwrite stock or journal balances.</p>
          <p className="mt-2 text-sm text-[var(--muted)]">Stock, till and bank checks remain distinct evidence. Store daily close brings them together for sign-off without silently adjusting a balance.</p>
        </section>
      )}
      {canAftersales && (
        <section id="after-sales" className="scroll-mt-24 rounded-2xl border bg-white p-5">
          <h2 className="text-xl font-semibold">Returns and aftersales</h2>
          <p className="mt-2 text-sm leading-6">Create installation, maintenance, repair and other service rates in Products using Catalogue item type → Service — no physical stock. Set the retail price before VAT and the reviewed, configured VAT rate using the existing price controls. Service items cannot receive opening stock, be counted or be put on goods purchase orders. On a new Aftersales request, select Catalogue service and, separately, the physical product being worked on if relevant. The case keeps the original price/rate version. For non-warranty work its total including VAT is suggested; confirm the charge with a reason, or record zero for complimentary work. Partial receipts split configured VAT from service income and do not release goods. Existing custom/legacy service cases keep their original accounting treatment. Catalogue services currently use Aftersales; physical POS checkout remains separate until its service/document integration is completed.</p>
          <p className="mt-2 text-sm leading-6">On an open service case, use Assign / change service staff. Enter the employee&apos;s HR staff ID and a reason; the employee need not have an app login. Only active employees assigned to that store, or with no store restriction, can be assigned. The saved name and staff ID appear on the case. To unassign, leave the staff ID blank and explain why. Reassignment and removal are audited without changing payments, service status or stock. Closed cases cannot be reassigned. Interrupted assignment requests use the same saved-instructions retry as other service actions.</p>
          <p className="mt-2 text-sm leading-6">To record an outsourced technician or logistics provider bill, choose Record outsourced service / logistics cost on the service case, or Record delivery / service provider cost on an official sales invoice. In Expenses, select the cost purpose, payee, category, invoice reference and actual amount. The original record and store are verified on the server; switch to that store if needed. Submit, approve and record partial or full provider payments using the existing expense workflow and the company account actually used. Creating a draft does not post a journal; approval recognizes expense and payable, while payment clears only the paid amount. This does not increase the customer charge, collect money, release stock or complete the service case. Never enter an already-accrued delivery pass-through liability a second time. If interrupted, use Retry saved expense instructions, including after reloading in the same browser tab, before recording another bill or payment.</p>
          <p className="mt-2 text-sm leading-6">For goods routed from an approved inspected return, finish or cancel the service case, then open Held returned goods. Record the final destination and quantity: Restock requires an explicit resellable inspection confirmation and restores physical stock, availability and original inventory cost; Scrap permanently records disposal without charging the expense again. Hand over to supplier requires a supplier and physical handover reference. This handover records custody only: it does not create a supplier credit note, refund or payable reduction. Partial dispositions leave the remaining quantity held; exact serials cannot be disposed twice. Reasons, staff, stock entries and any accounting journal are linked and audited. If confirmation is interrupted, use Retry same disposition rather than starting another request.</p>
          <p className="mt-2 text-sm leading-6">When the supplier accepts a credit, open Supplier settlement · credits &amp; replacements below that handover. Authorized return/procurement/payables users choose the original supplier invoice, product and goods-received note, enter the accepted credit-note reference, quantity and reason, and confirm. Paid invoices are included; browse more invoice pages if needed. Credit uses original invoice price/tax snapshots, reduces unpaid debt first and leaves excess on the supplier account. Physical stock is not deducted again. Partial settlements show credited, replaced and remaining quantities live. Exact handed-over serials must match the original receipt. A later cash refund uses the separate supplier-credit refund workflow and selected company account. Cross-store or unverified historical purchases, batch goods and differing negotiated values require accounting review.</p>
          <p className="mt-2 text-sm leading-6">If the supplier sends same-product replacement goods instead of a credit, open Receive supplier replacement goods beneath the handover. Enter the quantity, supplier replacement reference and inspection notes; read the replacement serial directly from the unit where applicable. Confirm that you physically received and inspected resellable goods, then Confirm replacement receipt. Authorized returns/procurement/inventory staff may record partial receipts. New serials cannot duplicate another unit; the original serial is accepted only when that exact unit comes back from supplier custody. The receipt restores the original cost to store inventory and does not create another purchase, VAT, cash payment or supplier debt. Credited and replaced quantities share one limit, so the same unit cannot be settled twice. Customer collection remains a separate recorded action; this does not revive a refunded sale or reserve stock automatically. Use Photos &amp; serial evidence on the latest replacement receipt to attach an optional private receiving photo. After an interrupted confirmation, Retry same replacement receipt; after reloading, check settlement counters and product stock history before entering another request. Different-product exchanges and additional charges require a separate reviewed transaction.</p>
          <p className="mt-2 text-sm leading-6">After approving an inspected warranty or repair return, open Warranty / repair follow-up on the posted return. Select the held item (one exact serial at a time), describe the service request and choose Send to aftersales. For walk-in returns, enter a contact name and phone. Open service case takes you directly to its record. A quantity-tracked line creates one case for its returned quantity; retries do not create duplicates. Goods stay separate from saleable stock, and service completion does not restock them or issue another refund. Warranty eligibility and any charge or complimentary decision are still recorded in Aftersales. For warranty service without a sales refund/reversal, create a normal Aftersales case instead of returning the sale.</p>
          <p className="mt-2 text-sm leading-6">For a returned sale, find its receipt or sale number in <Link className="font-semibold underline" href="/returns">Returns</Link>, select only the quantities physically handed back, choose refund/credit and give the reason. In Inspection &amp; approval, open Inspect returned goods, record each item&apos;s disposition and inspection findings, then Record inspection. Only items explicitly confirmed resellable are added back on approval. Keep damaged, defective, warranty, repair, scrap and supplier-return goods physically separate; use the recorded disposition to route warranty/repair through Aftersales or organize the next authorized action. These held goods are not added to saleable inventory. Reduce receivables only up to the actual outstanding debt. Managers with the required permissions can inspect and approve without another person&apos;s approval; both actions are audited. Historical approved returns are not rewritten. Pending older goods returns also require inspection before posting. Cancellation of uncollected goods does not require physical inspection because the goods never left.</p>
          <p className="mt-2 text-sm leading-6">The returns register has 25/50/100-row pages and a posted-return view for remaining exchange balances. If recording a credit refund loses connection, use Retry same request; do not enter another payment. After reloading, check the posted balance and history before trying again. A stock-only reversal is not allowed for a posted customer return or reservation cancellation; use a linked accounting/inventory correction workflow.</p>
          <p className="mt-2 text-sm leading-6">For installation, repair, warranty or other service work, open <Link className="font-semibold underline" href="/aftersales">Aftersales</Link>. Link the customer and sale when available, track the case status, record a charge or complimentary reason and capture payments to the correct company account. If a creation, status update, charge or payment is interrupted, use Retry saved service instructions in the same browser tab, including after a reload. Do not collect the payment again or start a different service action until the saved result is confirmed. Changed amounts/accounts need a new reviewed transaction, not an altered retry. A retry denied after switching stores remains saved; switch back to an authorized store and retry. Service receipts retain the existing accounting treatment; this does not release inventory or change the original sales invoice.</p>
          <p className="mt-2 text-sm leading-6">Open Receipts &amp; refunds on a service case for its paginated payment history (25, 50 or 100 rows). Authorized staff can choose Refund receipt, enter a full or partial amount and a reason, and select the company account paying it. The original receipt and journal remain preserved; the refund has its own linked balanced journal and reverses the applicable recognized VAT using the case&apos;s original configuration. This is a payment correction: the refunded amount becomes due again, and the service charge is not waived. It does not cancel work, return physical goods or alter a sales invoice. If interrupted, close the refund form and use Retry saved service instructions rather than paying again.</p>
          <p className="mt-2 text-sm leading-6">Open Photos &amp; serial evidence on an aftersales case to record its condition at intake, diagnosis or handover. The available stage follows the case status. Select the serial already recorded on the case, confirm it visually and describe the photo. For supplier handovers, open Purchasing → Returns &amp; credit notes, choose a recorded return under Photos for a recorded return, then open Photos &amp; serial evidence. Enter the serial from the physical unit; the server accepts only serials recorded on that return. This supplements an already-posted return; it never posts a second stock movement, credit or payment.</p>
          <p className="mt-2 text-sm leading-6">For goods receiving, open a purchase order’s Receiving history, then Open note and Photos &amp; serial evidence. Receiving staff can attach photos to that posted GRN; serials are checked against its original stock ledger. For customer returns, expand Photos &amp; serial evidence on the submitted physical return before approval. Authorized inspectors can record condition and serial-label photos, then separately record the inspection decision. Posted returns retain read-only photo history. Cancelling uncollected goods does not need an inspection photo. Photos never approve inspection, restock goods, or issue refunds automatically.</p>
          <p className="mt-2 text-sm leading-6">Choose a JPEG/PNG photo up to 2 MB, or use your device camera where supported. Up to 20 private photos can be recorded per case/return. Each preserves its stage, serial, description, recording staff and upload time. Photos cannot be edited or removed here. A photo does not itself confirm collection or supplier acceptance: record the real workflow action separately. If confirmation is interrupted, use Retry same photo. Evidence requires an online connection. Do not upload unrelated customer documents or use OCR as proof of a serial.</p>
        </section>
      )}
      {(canFinance || canReport) && (
        <section id="finance" className="scroll-mt-24 rounded-2xl border bg-white p-5">
          <h2 className="flex items-center gap-2 text-xl font-semibold"><FileBarChart2 className="size-5" /> Reports and finance</h2>
          {canFinance && <p className="mt-2 text-sm leading-6">Accounting includes Budgets versus actuals. Choose a month and store (or All locations for consolidated targets), then view 25, 50 or 100 income/expense targets compared with posted journal activity. Authorized budget managers save targets with a reason; use Revise to update a row and View revisions to inspect earlier amounts. Positive variance means favorable: more income or less expense. A zero target has no variance percentage. Organization targets are separate from store targets, not their automatic sum. Only accounts with a saved target appear, and these comparisons are not cash balances or taxable-profit assessments. No journal is posted when saving a budget. If the result is uncertain, retry the saved instructions before saving anything else.</p>}
          {canReport && <p className="mt-2 text-sm leading-6">Use <Link className="font-semibold underline" href="/reports">Reports</Link> for sales, inventory and the available financial statements. Select the reporting dates and store or entire organization. Sales, stock and valuation cards summarize every matching record, not only visible rows. The balance sheet shows ledger-based net assets (assets less liabilities). Download the result where export is offered.</p>}
          {canFinance && <p className="mt-2 text-sm leading-6">Use <Link className="font-semibold underline" href="/finance">Accounting</Link> for company accounts and month close. {canTax && <><Link className="font-semibold underline" href="/tax">Tax Centre</Link> shows ledger VAT evidence and reviewed rule versions; it does not invent a current statutory rate or file a tax return for you.</>}</p>}
          {canTax && <p className="mt-2 text-sm leading-6">Tax Centre has a paginated rule register (25/50/100). Authorized tax administrators propose a new version with tax/scope, bounded effective dates, calculation basis, rate, applicability, exemptions and an authoritative source/section. Expand View rule to review and explicitly approve or reject it with a reason. Approved versions cannot be edited and their periods cannot overlap for the same tax/scope. A draft does not calculate tax. Approved rules offer a preview using an accountant-reviewed taxable or assessable base; accounting profit or turnover is not automatically that base. Previews do not post liabilities/payments, reprice POS, file returns or recalculate historical transactions. If saving/reviewing has an uncertain result, retry the exact saved tax instructions in the same tab. Missing company tax-profile evidence, exemptions and statutory adjustments still require professional review.</p>}
          {canFinance && <p className="mt-2 text-sm leading-6">In <Link className="font-semibold underline" href="/banking">Company accounts</Link>, authorized finance staff can Record completed transfer between two configured active bank accounts. First move the money through the bank, then select the responsible store, source and destination, amount, actual date, bank reference and reason. The app does not initiate a bank payment. Both ledger sides post together with one journal and audit reference; a transfer is not revenue or an expense. Closed accounting months cannot be changed. If confirmation is interrupted, Retry saved transfer checks the same request, including after a page reload in that tab. Do not record another transfer for the same movement. Opening-balance settings are not rewritten. Cash/till handovers and bank fees require their own applicable workflows.</p>}
          {canFinance && <p className="mt-2 text-sm leading-6">In <Link className="font-semibold underline" href="/finance">Accounting</Link>, review the dated journal register, choose 25, 50 or 100 rows, and expand View lines for the actual debits and credits. Authorized accountants can create or edit non-system ledger accounts, post balanced opening balances, depreciation, accruals and adjustments, or reverse an original manual journal in an open period. Select the responsible store, posting date, reference, reason and cash-flow classification. Bank lines must identify an active company financial account; cash belongs to the selected store. Avoid duplicating opening balances already posted. Inventory, customer/supplier debt, advances and statutory tax controls must be corrected through their operational workflow, not manual journals. A reversal posts opposite lines and links the original; it never deletes or edits the original amounts. If a posting result is uncertain, retry the saved accounting instructions in the same tab before starting another. Accountant review remains necessary before issuing external statements.</p>}
        </section>
      )}
      {canHr && (
        <section id="people" className="scroll-mt-24 rounded-2xl border bg-white p-5">
          <h2 className="text-xl font-semibold">Employees and attendance</h2>
          <p className="mt-2 text-sm leading-6">Add employees in <Link className="font-semibold underline" href="/hr">HR &amp; attendance</Link> even if they never sign in to this app. An app user can be linked to an employee. Record attendance corrections with a reason and keep salary terms and staff activities in their separate records.</p>
          <p className="mt-2 text-sm text-[var(--muted)]">The HR page has a four-step fingerprint-device checklist. Add employees, match each terminal user ID, obtain the device model and API/export details from its installer, then have an integrator connect and test it. Entering an attendance ID alone does not connect a scanner or run payroll; never upload fingerprint templates or device credentials to employee records.</p>
          <p className="mt-2 text-sm text-[var(--muted)]">No device yet? Start with employee records and manual attendance. Before buying, ask the supplier for the exact model’s integration manual and an attendance-only sample export, plus details of any required licence or gateway. Compatibility must be checked before promising automatic sync.</p>
        </section>
      )}
      <section id="alerts" className="scroll-mt-24 rounded-2xl border bg-white p-5">
        <h2 className="text-xl font-semibold">Notifications</h2>
        <p className="mt-2 text-sm leading-6">Tap the bell to see unread alerts, open the related task, mark one as read, or clear all. Read alerts disappear from the bell but remain in the <Link className="font-semibold underline" href="/notifications">notification inbox</Link>. You can enable browser notifications on each supported device; the inbox remains available if push is off or unsupported. On iPhone, install the app to the Home Screen before requesting push.</p>
      </section>
      {canAdmin && (
        <section id="setup" className="scroll-mt-24">
          <WorkflowTrack
            title="Administrator: first-time setup"
            description="Record existing stock where it is physically held, including stock already at branches. Do not invent a transfer for opening stock."
            steps={setupWorkflowSteps}
          />
          <p className="mt-2 text-sm leading-6">To create a stock count, choose the stock location and an eligible counter. Only active users with counting permission and access to that store are offered. A system administrator with organization-wide access does not need a separate store assignment. Changing the location clears the previous counter selection. Retrying the same creation request does not create another count; changing its details requires a new request.</p>
          <p className="mt-4 rounded-xl border bg-white p-4 text-sm leading-6">Opening stock and stock-count adjustments create linked, balanced accounting entries using the recorded stock cost, not selling price. They are not cash receipts or payments. A closed accounting period blocks posting. Authorized managers may review and post a count themselves; the reason and each stock correction remain audited. If count posting is interrupted, retry the same count with its original reason to resume, rather than creating another count. Corrections to posted stock must use the reversal workflow, which also reverses its linked journal. Older stock-only records retain their original history.</p>
          <p className="mt-2 text-sm leading-6">In Stock counts, open a count and choose 25, 50 or 100 items per page. Enter the quantity physically found; enter 0 explicitly when none are found. A blank field is not zero. Save this page records progress without submitting or moving stock. Moving to another page saves entered quantities first; if saving fails, your inputs stay on screen. Submit complete count only after every page has been counted. The server rejects incomplete submission, review or posting. Blind counts hide system quantities from assigned counters who do not have review permission. Large snapshots are not silently truncated: starting a count currently requires no more than 2000 stock positions and 5000 active serials in that location. A larger snapshot stays a draft and needs staged-snapshot support; paging does not remove that separate limit.</p>
          <p className="mt-4 rounded-xl border bg-white p-4 text-sm leading-6">In <Link className="font-semibold underline" href="/administration/roles">Roles &amp; permissions</Link>, create a named role, choose its location scope and permissions, and edit it later with a reason. Then assign one or more built-in or custom roles and permitted stores in <Link className="font-semibold underline" href="/administration/users">Users</Link>. Role changes are audited and update assigned users. You can also resend an expired invitation or deactivate a user without erasing past actions. Employees without app access belong in HR instead.</p>
        </section>
      )}
      {(canHr || canReport || canFinance) && <section className="space-y-4 rounded-2xl border bg-white p-5" aria-label="Reporting help">
        <h2 className="text-xl font-semibold">Review recorded results</h2>
        {canReport && <p className="text-sm leading-6">In <Link href="/reports" className="font-semibold underline">Reports → Sales register</Link>, choose Daily, Weekly, Monthly or Custom dates and a store. All sales summary and Credit sales summary cover the full selected range. Credit issued means the original unpaid amount at sale, not today&apos;s outstanding debt. Users with sales-report and inventory-cost access can choose Calculate product margins, then Export product CSV. Product margins use invoices issued in that range, with their current collections and approved returns even when those occurred later. VAT and overhead are excluded. Unknown means cost evidence, collection or later held-return recovery is incomplete; never read it as zero cost. Use Financial statements for posted period profit and loss.</p>}
        {canHr && <p className="text-sm leading-6">In <Link href="/hr" className="font-semibold underline">HR &amp; attendance</Link>, find Attendance and staff activity history. Choose Attendance or Staff activity, From, To and Rows. Next and Previous page all recorded events for those Nigerian business dates. Export full range CSV gathers every page; shorten ranges above 10,000 events. For example, select September 1–30 to review September clock events. These events do not infer hours worked, lateness, overtime or payroll. HR read access is required; salary access remains separate.</p>}
        {canFinance && <p className="text-sm leading-6">In <Link href="/finance" className="font-semibold underline">Finance → Budgets versus actuals</Link>, use Compare monthly budgets. Set From month and To month, choose Compare months, then Export comparison CSV. Compare up to 12 months of saved targets against posted journals. A month with no saved target is identified rather than treated as a zero budget. Store targets stay separate from organization targets. Higher income or lower expense gives a favorable variance. Viewing requires finance journal access; changing targets requires budget-management access.</p>}
      </section>}
      {canTransfer && <details
        id="detailed-transfers"
        className="scroll-mt-24 rounded-2xl border bg-white p-5"
      >
        <summary className="cursor-pointer font-semibold">
          Earlier transfers / optional detailed logistics
        </summary>
        <div className="mt-4">
          <WorkflowTrack
            title="Detailed transfer workflow"
            description="Use this only for existing detailed transfers or when the business chooses package and dispatch tracking. It is not required for a new normal transfer."
            steps={detailedTransferWorkflowSteps}
          />
        </div>
        <Link
          href="/transfers/legacy"
          className="mt-4 inline-flex min-h-12 items-center font-semibold text-emerald-800 underline"
        >
          Open detailed transfer records
        </Link>
      </details>}
      <section className="flex gap-3 rounded-2xl bg-emerald-950 p-5 text-white">
        <ShieldCheck className="size-6 shrink-0 text-amber-300" />
        <div>
          <h2 className="font-semibold">
            Fewer steps, with stock still protected
          </h2>
          <p className="mt-2 text-sm leading-6 text-emerald-100">
            Approval holds goods; it does not confirm they arrived. Receiving
            records the real quantities and keeps damaged goods out of saleable
            stock. Every action records who did it. Returns, expenses,
            purchasing and accounting keep their own auditable records.
          </p>
        </div>
      </section>
    </div>
  );
}

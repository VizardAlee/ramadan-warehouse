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
            <p className="mt-2 text-sm">Find bank reconciliation, financial reports, tax evidence and month close.</p>
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
          <details className="surface p-4"><summary className="cursor-pointer font-semibold">Paid goods awaiting collection</summary><p className="mt-3 text-sm leading-6">When confirming payment, choose “reserve for later” if the customer has not taken the goods. They remain physically in the store but cannot be sold again. Choose “collect now” only when handing them over. Later, open “Goods awaiting collection” in POS, review the invoice, enter the quantities actually collected and the collector’s name, then record physical collection. Partial collection leaves the rest reserved. A stock-release permission is required. Collection updates stock, cost accounting and audit together and requires internet access. Old sales and offline checkout retain their existing immediate-collection behaviour. Returns apply only to goods already collected; do not use Returns to cancel an uncollected reservation.</p></details>
          <WorkflowTrack
            title="Sell and account"
            description="Prices and product information are reused. VAT is separate; confirmed sales create controlled documents. You can type a quantity, hold a basket locally and create a customer without leaving POS."
            steps={salesWorkflowSteps}
          />
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
          <p className="rounded-xl border bg-white p-4 text-sm leading-6">For bank/card customer repayments, choose the receiving company account. For bank/card refunds in Returns, choose the company account paying the refund. Cash refunds still require an open till. POS, supplier, expense and aftersales payments also identify the company account used. Configure accounts in Banking; the selected account is recorded with the payment and balanced accounting journal.</p>
          <p className="rounded-xl border bg-white p-4 text-sm leading-6">
            To take cash, card and bank transfer on one sale, choose Split across payment methods and enter each amount. Card and transfer lines need the receiving company account. Select a named customer and enable customer credit only when an unpaid balance is intended. An unposted order can be rejected from Awaiting action with a reason; return or reverse any money physically collected first and include its reference. A completed sale needs the Returns workflow instead.
          </p>
          <p className="rounded-xl border bg-white p-4 text-sm leading-6">
            To use exchange credit, first submit and approve the original sale return with Exchange credit as its resolution. Start a new sale in the same store, choose Exchange credit as the payment method, and select the issued credit number. The credit pays up to its remaining balance; any shortfall is recorded as cash, and unused credit remains for another sale. Exchange credit requires an online connection.
          </p>
          <p className="rounded-xl border bg-white p-4 text-sm leading-6">Use New sale, Awaiting action and Held sales at the top of POS to jump between tasks. On smaller screens, tap Current sale above the bottom menu to open the cart; your basket stays in place while you browse.</p>
        </section>
      )}
      {canPurchase && (
        <section id="purchasing" className="scroll-mt-24 rounded-2xl border bg-white p-5">
          <h2 className="text-xl font-semibold">Purchasing and supplier payments</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6">
            <li>In <Link className="font-semibold underline" href="/procurement">Purchasing</Link>, review existing orders first. Expand New order only when needed, then choose the supplier and receiving store. There is no separate warehouse to create.</li>
            <li>Create and approve the purchase order, then record the goods actually received. Check quantities and any tracked serials before posting.</li>
            <li>Record the supplier invoice and any outstanding payment. Choose the company account used for a bank or card payment; do not mark a bank payment as cash.</li>
          </ol>
        </section>
      )}
      {canReconcile && (
        <section id="daily-checks" className="scroll-mt-24 rounded-2xl border bg-white p-5">
          <h2 className="text-xl font-semibold">Daily checks</h2>
          <p className="mt-2 text-sm leading-6">Open <Link className="font-semibold underline" href="/daily-reconciliation">Daily checks</Link> to count shelf stock, check ledger balances, close the POS shift with actual till cash, and match bank entries. Record the reason for a variance; counts do not silently overwrite stock.</p>
          <p className="mt-2 text-sm text-[var(--muted)]">These are separate auditable checks, not yet one signed-off daily close covering every cash movement.</p>
        </section>
      )}
      {canAftersales && (
        <section id="after-sales" className="scroll-mt-24 rounded-2xl border bg-white p-5">
          <h2 className="text-xl font-semibold">Returns and aftersales</h2>
          <p className="mt-2 text-sm leading-6">For a returned sale, find its receipt or sale number in <Link className="font-semibold underline" href="/returns">Returns</Link>, select only the returned quantities, choose a refund or exchange credit and give the reason. Reduce customer receivables only up to the actual outstanding balance. An authorized user posts the return. The exchange credit can then be used in POS.</p>
          <p className="mt-2 text-sm leading-6">For installation, repair, warranty or other service work, open <Link className="font-semibold underline" href="/aftersales">Aftersales</Link>. Link the customer and sale when available, track the case status, record a charge or complimentary reason and capture payments to the correct company account.</p>
        </section>
      )}
      {(canFinance || canReport) && (
        <section id="finance" className="scroll-mt-24 rounded-2xl border bg-white p-5">
          <h2 className="flex items-center gap-2 text-xl font-semibold"><FileBarChart2 className="size-5" /> Reports and finance</h2>
          {canReport && <p className="mt-2 text-sm leading-6">Use <Link className="font-semibold underline" href="/reports">Reports</Link> for sales, inventory and the available financial statements. Select the reporting dates and store or entire organization. Sales, stock and valuation cards summarize every matching record, not only visible rows. The balance sheet shows ledger-based net assets (assets less liabilities). Download the result where export is offered.</p>}
          {canFinance && <p className="mt-2 text-sm leading-6">Use <Link className="font-semibold underline" href="/finance">Accounting</Link> for company accounts and month close. {canTax && <><Link className="font-semibold underline" href="/tax">Tax Centre</Link> shows ledger VAT evidence and reviewed rule versions; it does not invent a current statutory rate or file a tax return for you.</>}</p>}
        </section>
      )}
      {canHr && (
        <section id="people" className="scroll-mt-24 rounded-2xl border bg-white p-5">
          <h2 className="text-xl font-semibold">Employees and attendance</h2>
          <p className="mt-2 text-sm leading-6">Add employees in <Link className="font-semibold underline" href="/hr">HR &amp; attendance</Link> even if they never sign in to this app. An app user can be linked to an employee. Record attendance corrections with a reason and keep salary terms and staff activities in their separate records.</p>
          <p className="mt-2 text-sm text-[var(--muted)]">The HR page has a four-step fingerprint-device checklist. Add employees, match each terminal user ID, obtain the device model and API/export details from its installer, then have an integrator connect and test it. Entering an attendance ID alone does not connect a scanner or run payroll; never upload fingerprint templates or device credentials to employee records.</p>
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
          <p className="mt-4 rounded-xl border bg-white p-4 text-sm leading-6">In <Link className="font-semibold underline" href="/administration/roles">Roles &amp; permissions</Link>, create a named role, choose its location scope and permissions, and edit it later with a reason. Then assign one or more built-in or custom roles and permitted stores in <Link className="font-semibold underline" href="/administration/users">Users</Link>. Role changes are audited and update assigned users. You can also resend an expired invitation or deactivate a user without erasing past actions. Employees without app access belong in HR instead.</p>
        </section>
      )}
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

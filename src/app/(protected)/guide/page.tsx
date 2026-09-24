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
  const canPurchase = Boolean(profile && hasAnyPermission(profile, ["procurement.read", "payables.read"]));
  const canReconcile = Boolean(profile && hasAnyPermission(profile, ["inventory.count", "inventory.reconcile", "sales.shift.manage", "banking.read"]));
  const canAftersales = Boolean(profile && hasPermission(profile, "sales.returns.read"));
  const canFinance = Boolean(profile && hasAnyPermission(profile, ["finance.journal.read", "banking.read", "accounting.close.read"]));
  const canHr = Boolean(profile && hasPermission(profile, "hr.read"));
  const canReport = Boolean(profile && hasAnyPermission(profile, ["reports.inventory.read", "reports.requests.read", "reports.transfers.read", "reports.sales.read", "finance.journal.read"]));
  const canAdmin = Boolean(profile && hasAnyPermission(profile, ["organization.manage", "branch.manage", "warehouse.manage", "location.manage", "user.manage", "role.manage"]));
  const canTax = Boolean(profile && hasPermission(profile, "finance.journal.read"));
  return (
    <div className="page-stack">
      <header>
        <p className="text-sm font-semibold uppercase tracking-wider text-emerald-800">
          Quick help
        </p>
        <h1 className="mt-2 text-3xl font-semibold">What do you want to do?</h1>
        <p className="mt-2 text-[var(--muted)]">
          Choose a task. You do not need to learn every part of the system.
        </p>
      </header>
      <nav
        aria-label="Choose a help topic"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
      >
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
                Open Action required, count the goods, and confirm arrival.
              </p>
            </Link>
          </>
        )}
        {canSell && (
          <Link href="/pos" className="rounded-2xl border bg-white p-5">
            <ShoppingCart className="mb-3 size-7 text-emerald-800" />
            <strong>Make a sale</strong>
            <p className="mt-2 text-sm">
              Select your branch, open a shift, then add products to the sale.
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
          <WorkflowTrack
            title="Sell and account"
            description="Prices and product information are reused. VAT is separate; confirmed sales create controlled documents. You can type a quantity, hold a basket locally and create a customer without leaving POS."
            steps={salesWorkflowSteps}
          />
          <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
            Offline POS can save an order for later sync using an already-open cached shift. Opening a new shift, creating a customer and credit sales require a connection. A held basket is only on this device and does not reserve stock.
          </p>
        </section>
      )}
      {canPurchase && (
        <section id="purchasing" className="scroll-mt-24 rounded-2xl border bg-white p-5">
          <h2 className="text-xl font-semibold">Purchasing and supplier payments</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6">
            <li>In <Link className="font-semibold underline" href="/procurement">Purchasing</Link>, choose the supplier and receiving store. The store is also where you can sell; there is no separate warehouse to create.</li>
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
          <p className="mt-2 text-sm leading-6">For a returned sale, find the receipt in <Link className="font-semibold underline" href="/returns">Returns</Link>, select only the returned quantities, choose a refund or exchange credit and give the reason. An authorized user posts the return. The exchange credit can then be used in POS.</p>
          <p className="mt-2 text-sm leading-6">For installation, repair, warranty or other service work, open <Link className="font-semibold underline" href="/aftersales">Aftersales</Link>. Link the customer and sale when available, track the case status, record a charge or complimentary reason and capture payments to the correct company account.</p>
        </section>
      )}
      {(canFinance || canReport) && (
        <section id="finance" className="scroll-mt-24 rounded-2xl border bg-white p-5">
          <h2 className="flex items-center gap-2 text-xl font-semibold"><FileBarChart2 className="size-5" /> Reports and finance</h2>
          {canReport && <p className="mt-2 text-sm leading-6">Use <Link className="font-semibold underline" href="/reports">Reports</Link> for sales, inventory and the available financial statements. Select the reporting dates and location, then download the result where export is offered.</p>}
          {canFinance && <p className="mt-2 text-sm leading-6">Use <Link className="font-semibold underline" href="/finance">Accounting</Link> for company accounts and month close. {canTax && <><Link className="font-semibold underline" href="/tax">Tax Centre</Link> shows ledger VAT evidence and reviewed rule versions; it does not invent a current statutory rate or file a tax return for you.</>}</p>}
        </section>
      )}
      {canHr && (
        <section id="people" className="scroll-mt-24 rounded-2xl border bg-white p-5">
          <h2 className="text-xl font-semibold">Employees and attendance</h2>
          <p className="mt-2 text-sm leading-6">Add employees in <Link className="font-semibold underline" href="/hr">HR &amp; attendance</Link> even if they never sign in to this app. An app user can be linked to an employee. Record attendance corrections with a reason and keep salary terms and staff activities in their separate records.</p>
          <p className="mt-2 text-sm text-[var(--muted)]">An external fingerprint connector needs its own integration setup; recording an attendance ID alone does not connect a scanner or run payroll.</p>
        </section>
      )}
      <section id="alerts" className="scroll-mt-24 rounded-2xl border bg-white p-5">
        <h2 className="text-xl font-semibold">Notifications</h2>
        <p className="mt-2 text-sm leading-6">Open the <Link className="font-semibold underline" href="/notifications">notification inbox</Link> for action-needed items and recent updates. You can enable browser notifications on each supported device; the inbox remains available if push is off or unsupported. On iPhone, install the app to the Home Screen before requesting push.</p>
      </section>
      {canAdmin && (
        <section id="setup" className="scroll-mt-24">
          <WorkflowTrack
            title="Administrator: first-time setup"
            description="Record existing stock where it is physically held, including stock already at branches. Do not invent a transfer for opening stock."
            steps={setupWorkflowSteps}
          />
          <p className="mt-4 rounded-xl border bg-white p-4 text-sm leading-6">In <Link className="font-semibold underline" href="/administration/users">Users</Link>, assign multiple roles and permitted stores, resend an expired invitation, or disable a user without erasing past actions. Employees without app access belong in HR instead.</p>
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

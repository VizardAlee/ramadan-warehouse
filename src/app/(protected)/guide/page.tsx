"use client";

import Link from "next/link";
import {
  Boxes,
  PackageCheck,
  ShoppingCart,
  Settings,
  ShieldCheck,
} from "lucide-react";
import { useAuth } from "@/features/auth/auth-context";
import { WorkflowTrack } from "@/features/guidance/workflow-track";
import {
  detailedTransferWorkflowSteps,
  salesWorkflowSteps,
  setupWorkflowSteps,
  transferWorkflowSteps,
} from "@/features/guidance/workflows";

export default function GuidePage() {
  const { profile } = useAuth();
  const roles = profile?.roleIds?.length ? profile.roleIds : [profile?.roleId];
  const isAdmin = roles.some(
    (r) => r === "system_administrator" || r === "operations_administrator",
  );
  const canTransfer =
    isAdmin ||
    roles.some((r) => r === "warehouse_manager" || r === "branch_manager");
  const canSell =
    isAdmin ||
    roles.some((r) => r === "sales_cashier" || r === "branch_manager");
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
        className="grid gap-4 sm:grid-cols-2"
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
                Choose a warehouse or another branch. No packaging or transport
                form.
              </p>
            </Link>
            <Link href="/transfers" className="rounded-2xl border bg-white p-5">
              <PackageCheck className="mb-3 size-7 text-emerald-800" />
              <strong>Goods have arrived</strong>
              <p className="mt-2 text-sm">
                Open Needs my attention, count the goods, and confirm arrival.
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
        {isAdmin && (
          <Link href="#setup" className="rounded-2xl border bg-white p-5">
            <Settings className="mb-3 size-7 text-emerald-800" />
            <strong>Set up locations, people or existing stock</strong>
            <p className="mt-2 text-sm">
              Administrator setup is separate from everyday work.
            </p>
          </Link>
        )}
      </nav>
      <section id="transfers" className="scroll-mt-24 space-y-4">
        <WorkflowTrack
          title="Move stock in three steps"
          description="Warehouse to branch, or branch to branch. One administrator and the receiving manager can complete the normal journey."
          steps={transferWorkflowSteps}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
            <h2 className="font-semibold">
              Example: 20 panels for Igbo Road Branch
            </h2>
            <p className="mt-2 text-sm leading-6">
              Choose the location holding the panels and request 20. The
              administrator approves. When the panels arrive, the receiving
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
              Needs my attention shows actions you can take. Waiting shows work
              assigned to someone else.
            </li>
            <li>
              Only an administrator approves. Only the receiving branch manager
              or an administrator confirms arrival.
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
      </section>
      {canSell && (
        <WorkflowTrack
          title="Sell and account"
          description="Prices and product information are reused. VAT is separate; confirmed sales create controlled documents."
          steps={salesWorkflowSteps}
        />
      )}
      {isAdmin && (
        <section id="setup" className="scroll-mt-24">
          <WorkflowTrack
            title="Administrator: first-time setup"
            description="Record existing stock where it is physically held, including stock already at branches. Do not invent a transfer for opening stock."
            steps={setupWorkflowSteps}
          />
        </section>
      )}
      <details
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
      </details>
      <section className="flex gap-3 rounded-2xl bg-emerald-950 p-5 text-white">
        <ShieldCheck className="size-6 shrink-0 text-amber-300" />
        <div>
          <h2 className="font-semibold">
            Fewer steps, with stock still protected
          </h2>
          <p className="mt-2 text-sm leading-6 text-emerald-100">
            Approval holds goods; it does not confirm they arrived. Receiving
            records the real quantities and keeps damaged goods out of saleable
            stock. Every action records who did it. Separate controls for
            returns, expenses, purchasing and accounting are unchanged.
          </p>
        </div>
      </section>
    </div>
  );
}

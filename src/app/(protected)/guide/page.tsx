import { CircleHelp, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { WorkflowTrack } from "@/features/guidance/workflow-track";
import {
  salesWorkflowSteps,
  setupWorkflowSteps,
  transferWorkflowSteps,
} from "@/features/guidance/workflows";

export default function GuidePage() {
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Visual user guide"
        title="How ABR Warehouse works"
        description="Follow each workflow in order. The app reuses master data, protects stock and accounting evidence, and shows the next authorized action on each record."
      />
      <section className="grid gap-4 rounded-xl border border-amber-200 bg-amber-50 p-5 sm:grid-cols-[auto_1fr] sm:p-6">
        <span className="grid size-11 place-items-center rounded-xl bg-white text-amber-700">
          <CircleHelp className="size-6" />
        </span>
        <div>
          <h2 className="font-semibold text-amber-950">
            New user? Start with setup, not a transfer.
          </h2>
          <p className="mt-1 text-sm leading-6 text-amber-900">
            Create the real locations, catalogue, prices, and opening stock
            first. A transfer is only for moving stock between an existing
            warehouse and an existing store/branch.
          </p>
        </div>
      </section>
      <WorkflowTrack
        title="1. Set up the business"
        description="Enter each fact once so later forms can reuse it."
        steps={setupWorkflowSteps}
      />
      <div id="transfers" className="scroll-mt-24">
        <WorkflowTrack
          title="2. Move stock to a store / branch"
          description="After reservation, the immediate next task is picking. Every later stage confirms a physical event."
          steps={transferWorkflowSteps}
        />
      </div>
      <WorkflowTrack
        title="3. Sell and account"
        description="A sale links branch stock, VAT, payment, documents, returns, and accounting evidence."
        steps={salesWorkflowSteps}
      />
      <section className="rounded-xl border bg-[#10291f] p-5 text-white sm:p-6">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 size-6 shrink-0 text-amber-300" />
          <div>
            <h2 className="text-lg font-semibold">
              Why some actions need another person
            </h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-emerald-100">
              Creating and approving the same transfer, return, expense,
              purchase, bank reconciliation, or month close is intentionally
              blocked. This maker-checker control protects stock and financial
              evidence; it is not a missing permission.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

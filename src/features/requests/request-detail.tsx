"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import { useAuth } from "@/features/auth/auth-context";
import { hasPermission } from "@/lib/permissions/roles";
import type { BranchRequest, BranchRequestItem } from "@/types/domain";

interface RequestResult {
  request: BranchRequest;
  items: BranchRequestItem[];
  versions: Record<string, unknown>[];
  futureFulfilment: { message: string };
}
interface TimelineResult {
  events: Record<string, unknown>[];
  approvals: Record<string, unknown>[];
  comments: Record<string, unknown>[];
}
interface AvailabilityResult {
  rows: Record<string, unknown>[];
  includeCosts: boolean;
  warning: string;
}
interface Decision {
  approved: number;
  rejected: number;
  note: string;
}

export function RequestDetail({ requestId }: { requestId: string }) {
  const { profile } = useAuth();
  const [data, setData] = useState<RequestResult | null>(null);
  const [timeline, setTimeline] = useState<TimelineResult>({
    events: [],
    approvals: [],
    comments: [],
  });
  const [availability, setAvailability] = useState<AvailabilityResult | null>(
    null,
  );
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [reason, setReason] = useState("");
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      callAdministration<object, RequestResult>("getBranchRequest", {
        requestId,
        limit: 20,
      }),
      callAdministration<object, TimelineResult>("getBranchRequestTimeline", {
        requestId,
        limit: 100,
      }),
    ])
      .then(([requestResult, timelineResult]) => {
        if (!active) return;
        setData(requestResult);
        setTimeline(timelineResult);
        setDecisions(
          Object.fromEntries(
            requestResult.items.map((item) => [
              item.id,
              { approved: item.requestedQuantity, rejected: 0, note: "" },
            ]),
          ),
        );
      })
      .catch(() => {
        if (active)
          setMessage(
            "This request could not be loaded or is outside your scope.",
          );
      });
    return () => {
      active = false;
    };
  }, [requestId]);

  async function action(name: string, extra: Record<string, unknown> = {}) {
    if (!data) return;
    setLoading(true);
    setMessage(null);
    try {
      await callAdministration(name, {
        requestId,
        expectedVersion: data.request.version,
        reason: reason || undefined,
        idempotencyKey: crypto.randomUUID(),
        ...extra,
      });
      window.location.reload();
    } catch {
      setMessage(
        "The action was rejected. Reload the current version and verify permissions and decision quantities.",
      );
      setLoading(false);
    }
  }
  async function loadAvailability() {
    setLoading(true);
    try {
      setAvailability(
        await callAdministration<object, AvailabilityResult>(
          "getBranchRequestAvailability",
          { requestId, limit: 100, includeCosts: true },
        ),
      );
    } catch {
      setMessage("Availability is limited to authorized reviewers.");
    } finally {
      setLoading(false);
    }
  }
  async function addComment() {
    if (!comment.trim() || !profile) return;
    setLoading(true);
    try {
      await callAdministration("addBranchRequestComment", {
        requestId,
        comment,
        visibility: hasPermission(profile, "requests.review")
          ? "internal"
          : "branch",
        idempotencyKey: crypto.randomUUID(),
      });
      window.location.reload();
    } catch {
      setMessage("The comment could not be added.");
      setLoading(false);
    }
  }
  function updateDecision(itemId: string, patch: Partial<Decision>) {
    setDecisions((current) => ({
      ...current,
      [itemId]: {
        approved: 0,
        rejected: 0,
        note: "",
        ...current[itemId],
        ...patch,
      },
    }));
  }

  if (!data)
    return (
      <div className="rounded-xl border bg-white p-8">
        {message ?? "Loading request…"}
      </div>
    );
  const record = data.request;
  const canReview = profile ? hasPermission(profile, "requests.review") : false;
  const editable = ["draft", "changes_requested"].includes(record.status);
  const canDecide =
    canReview && ["submitted", "under_review"].includes(record.status);
  const decisionRows = data.items.map((item) => ({
    requestItemId: item.id,
    approvedQuantity: decisions[item.id]?.approved ?? 0,
    rejectedQuantity: decisions[item.id]?.rejected ?? 0,
    note: decisions[item.id]?.note || undefined,
  }));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-[var(--muted)]">Branch material request</p>
          <h1 className="text-3xl font-semibold">{record.requestNumber}</h1>
          <p>
            {record.status.replaceAll("_", " ")} · {record.priority} · version{" "}
            {record.version}
          </p>
        </div>
        <div className="flex gap-2">
          {editable &&
            profile &&
            hasPermission(profile, "requests.update_draft") && (
              <Link
                className="inline-flex min-h-10 items-center rounded-lg border bg-white px-4 text-sm font-semibold"
                href={`/requests/create?requestId=${requestId}`}
              >
                Edit draft
              </Link>
            )}
          {editable && profile && hasPermission(profile, "requests.submit") && (
            <Button
              disabled={loading}
              onClick={() => action("submitBranchRequest")}
            >
              Submit
            </Button>
          )}
          {record.status === "submitted" && canReview && (
            <Button
              disabled={loading}
              onClick={() => action("startBranchRequestReview")}
            >
              Start review
            </Button>
          )}
        </div>
      </header>
      {message && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm">{message}</p>
      )}
      <section className="grid gap-4 rounded-xl border bg-white p-6 md:grid-cols-3">
        <div>
          <span className="text-xs text-[var(--muted)]">Branch</span>
          <p className="font-medium">{record.branchId}</p>
        </div>
        <div>
          <span className="text-xs text-[var(--muted)]">Type</span>
          <p className="font-medium">
            {record.requestType.replaceAll("_", " ")}
          </p>
        </div>
        <div>
          <span className="text-xs text-[var(--muted)]">Required date</span>
          <p className="font-medium">
            {typeof record.requiredDate === "string"
              ? record.requiredDate.slice(0, 10)
              : "Not specified"}
          </p>
        </div>
        <div className="md:col-span-3">
          <span className="text-xs text-[var(--muted)]">Purpose</span>
          <p>{record.purpose}</p>
        </div>
      </section>
      <ItemTable items={data.items} />
      {canDecide && (
        <section className="space-y-4 rounded-xl border bg-white p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold">Material decision</h2>
              <p className="text-sm text-[var(--muted)]">
                Every unit must be explicitly approved or rejected.
              </p>
            </div>
            <Button
              variant="secondary"
              disabled={loading}
              onClick={loadAvailability}
            >
              Check availability
            </Button>
          </div>
          {data.items.map((item) => (
            <div
              key={item.id}
              className="grid gap-2 rounded-lg border p-3 md:grid-cols-[2fr_1fr_1fr_2fr]"
            >
              <div>
                <strong>{item.sku}</strong>
                <span className="block text-xs">
                  Requested: {item.requestedQuantity}
                </span>
              </div>
              <input
                aria-label={`Approved ${item.sku}`}
                className="rounded-lg border p-2.5"
                type="number"
                min="0"
                max={item.requestedQuantity}
                value={decisions[item.id]?.approved ?? 0}
                onChange={(event) =>
                  updateDecision(item.id, {
                    approved: Number(event.target.value),
                  })
                }
              />
              <input
                aria-label={`Rejected ${item.sku}`}
                className="rounded-lg border p-2.5"
                type="number"
                min="0"
                max={item.requestedQuantity}
                value={decisions[item.id]?.rejected ?? 0}
                onChange={(event) =>
                  updateDecision(item.id, {
                    rejected: Number(event.target.value),
                  })
                }
              />
              <input
                aria-label={`Note ${item.sku}`}
                className="rounded-lg border p-2.5"
                placeholder="Reviewer note"
                value={decisions[item.id]?.note ?? ""}
                onChange={(event) =>
                  updateDecision(item.id, { note: event.target.value })
                }
              />
            </div>
          ))}
          <textarea
            className="min-h-20 w-full rounded-lg border p-2.5"
            placeholder="Overall decision or rejection reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <div className="flex gap-2">
            <Button
              disabled={loading}
              onClick={() =>
                action("decideBranchRequest", { decisions: decisionRows })
              }
            >
              {loading && <Loader2 className="mr-2 size-4 animate-spin" />}
              Finalize decision
            </Button>
            <Button
              variant="secondary"
              disabled={loading || reason.trim().length < 3}
              onClick={() => action("requestBranchRequestChanges")}
            >
              Request changes
            </Button>
          </div>
        </section>
      )}
      {availability && <Availability result={availability} />}
      <section className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-xl border bg-white p-6">
          <h2 className="font-semibold">Approval and status timeline</h2>
          <div className="mt-3 space-y-3">
            {timeline.events.map((event) => (
              <div
                key={String(event.id)}
                className="border-l-2 border-emerald-700 pl-3 text-sm"
              >
                <strong>{String(event.eventType).replaceAll("_", " ")}</strong>
                <p className="text-[var(--muted)]">
                  {String(event.previousStatus ?? "created")} →{" "}
                  {String(event.newStatus)}
                </p>
                {event.reason ? <p>{String(event.reason)}</p> : null}
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border bg-white p-6">
          <h2 className="font-semibold">Version history</h2>
          <div className="mt-3 space-y-2">
            {data.versions.map((version) => (
              <p
                key={String(version.id)}
                className="rounded-lg bg-slate-50 p-3 text-sm"
              >
                Version {String(version.version)} · submitted by{" "}
                {String(version.submittedBy)}
              </p>
            ))}
          </div>
          <h3 className="mt-5 font-semibold">Future fulfilment</h3>
          <p className="mt-2 rounded-lg bg-slate-50 p-3 text-sm">
            {data.futureFulfilment.message}
          </p>
        </div>
      </section>
      <section className="rounded-xl border bg-white p-6">
        <h2 className="font-semibold">Comments</h2>
        <div className="mt-3 space-y-2">
          {timeline.comments.map((entry) => (
            <p
              key={String(entry.id)}
              className="rounded-lg bg-slate-50 p-3 text-sm"
            >
              {String(entry.comment)}
            </p>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <input
            className="flex-1 rounded-lg border p-2.5"
            placeholder={
              canReview ? "Internal reviewer note" : "Branch-visible comment"
            }
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
          <Button
            variant="secondary"
            disabled={loading || !comment.trim()}
            onClick={addComment}
          >
            Add comment
          </Button>
        </div>
      </section>
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-lg border p-2.5"
          placeholder="Reason required for cancellation or closure"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        {profile &&
          (hasPermission(profile, "requests.cancel_own") ||
            hasPermission(profile, "requests.cancel_approved")) && (
            <Button
              variant="secondary"
              disabled={loading || reason.trim().length < 3}
              onClick={() => action("cancelBranchRequest")}
            >
              Cancel request
            </Button>
          )}
        {profile && hasPermission(profile, "requests.close") && (
          <Button
            variant="secondary"
            disabled={loading || reason.trim().length < 3}
            onClick={() => action("closeBranchRequest")}
          >
            Close request
          </Button>
        )}
      </div>
    </div>
  );
}

function ItemTable({ items }: { items: BranchRequestItem[] }) {
  return (
    <section className="overflow-x-auto rounded-xl border bg-white">
      <table className="w-full whitespace-nowrap text-left text-sm">
        <thead className="bg-slate-50">
          <tr>
            {[
              "Product",
              "Requested",
              "Approved",
              "Rejected",
              "Fulfilled",
              "Outstanding",
              "Status",
            ].map((heading) => (
              <th key={heading} className="px-4 py-3">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-t">
              <td className="px-4 py-3">
                <strong>{item.sku}</strong>
                <span className="block text-xs text-[var(--muted)]">
                  {item.productName} · {item.trackingType}
                </span>
              </td>
              <td className="px-4 py-3">
                {item.requestedQuantity} {item.unitOfMeasure}
              </td>
              <td className="px-4 py-3">{item.approvedQuantity}</td>
              <td className="px-4 py-3">{item.rejectedQuantity}</td>
              <td className="px-4 py-3">{item.fulfilledQuantity}</td>
              <td className="px-4 py-3">{item.outstandingQuantity}</td>
              <td className="px-4 py-3">{item.itemStatus}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
function Availability({ result }: { result: AvailabilityResult }) {
  return (
    <section className="rounded-xl border bg-white p-6">
      <h2 className="font-semibold">Warehouse availability</h2>
      <p className="mt-1 flex items-center gap-2 text-sm text-amber-800">
        <AlertTriangle className="size-4" />
        {result.warning}
      </p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {result.rows.map((row) => (
          <div
            key={String(row.requestItemId)}
            className="rounded-lg border p-3 text-sm"
          >
            <strong>
              {String(row.sku)} — {String(row.productName)}
            </strong>
            <p>
              Available: {String(row.availableQuantity)} · On hand:{" "}
              {String(row.warehouseOnHandQuantity)}
            </p>
            <p>
              Damaged: {String(row.damagedQuantity)} · Quarantine:{" "}
              {String(row.quarantinedQuantity)}
            </p>
            {result.includeCosts && (
              <p>
                Estimated requested value: ₦
                {(Number(row.estimatedValueMinor ?? 0) / 100).toLocaleString()}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

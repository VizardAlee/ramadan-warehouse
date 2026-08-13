"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import { useOrganizationCollection } from "@/features/administration/use-organization-collection";
import { useAuth } from "@/features/auth/auth-context";
import { hasPermission } from "@/lib/permissions/roles";
import type {
  Branch,
  BranchRequest,
  BranchRequestItem,
  Product,
} from "@/types/domain";

interface DraftLine {
  productId: string;
  requestedQuantity: number;
  requesterNote: string;
}
interface RequestResult {
  request: BranchRequest;
  items: BranchRequestItem[];
}
const emptyLine = (): DraftLine => ({
  productId: "",
  requestedQuantity: 1,
  requesterNote: "",
});

export function RequestForm() {
  const { profile } = useAuth();
  const router = useRouter();
  const search = useSearchParams();
  const requestId = search.get("requestId");
  const products = useOrganizationCollection<Product>("products");
  const branches = useOrganizationCollection<Branch>("branches");
  const [branchId, setBranchId] = useState("");
  const [requestType, setRequestType] = useState("stock_replenishment");
  const [priority, setPriority] = useState("normal");
  const [purpose, setPurpose] = useState("");
  const [requiredDate, setRequiredDate] = useState("");
  const [projectReference, setProjectReference] = useState("");
  const [customerReference, setCustomerReference] = useState("");
  const [warrantyReference, setWarrantyReference] = useState("");
  const [version, setVersion] = useState(0);
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!requestId) return;
    let active = true;
    void callAdministration<object, RequestResult>("getBranchRequest", {
      requestId,
      limit: 20,
    })
      .then((result) => {
        if (!active) return;
        const record = result.request;
        setBranchId(record.branchId);
        setRequestType(record.requestType);
        setPriority(record.priority);
        setPurpose(record.purpose);
        setRequiredDate(
          typeof record.requiredDate === "string"
            ? record.requiredDate.slice(0, 10)
            : "",
        );
        setProjectReference(record.projectReference ?? "");
        setCustomerReference(record.customerReference ?? "");
        setWarrantyReference(record.warrantyReference ?? "");
        setVersion(record.version);
        setLines(
          result.items.map((item) => ({
            productId: item.productId,
            requestedQuantity: item.requestedQuantity,
            requesterNote: item.requesterNote ?? "",
          })),
        );
      })
      .catch(() => {
        if (active) setMessage("The draft could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, [requestId]);
  const allowedBranches = useMemo(() => {
    if (!profile) return [];
    if (hasPermission(profile, "requests.read.all")) return branches.data;
    return profile.branchIds.map(
      (branchId) =>
        branches.data.find((branch) => branch.id === branchId) ??
        ({ id: branchId, code: branchId, name: branchId } as Branch),
    );
  }, [branches.data, profile]);
  const selectedBranchId =
    branchId || (profile?.branchIds.length === 1 ? profile.branchIds[0]! : "");
  async function save() {
    if (
      !profile ||
      !selectedBranchId ||
      purpose.trim().length < 5 ||
      lines.some((line) => !line.productId || line.requestedQuantity <= 0) ||
      new Set(lines.map((line) => line.productId)).size !== lines.length
    ) {
      setMessage(
        "Choose a branch, provide a purpose, and add unique products with positive quantities.",
      );
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const payload = {
        branchId: selectedBranchId,
        requestType,
        priority,
        purpose,
        requiredDate: requiredDate || undefined,
        projectReference: projectReference || undefined,
        customerReference: customerReference || undefined,
        warrantyReference: warrantyReference || undefined,
        attachmentMetadata: [],
        items: lines.map((line) => ({
          productId: line.productId,
          requestedQuantity: Number(line.requestedQuantity),
          requesterNote: line.requesterNote || undefined,
        })),
        idempotencyKey: crypto.randomUUID(),
      };
      const result = requestId
        ? await callAdministration<object, { requestId: string }>(
            "updateBranchRequestDraft",
            { ...payload, requestId, expectedVersion: version },
          )
        : await callAdministration<object, { requestId: string }>(
            "createBranchRequest",
            payload,
          );
      router.push(`/requests/${result.requestId}`);
    } catch {
      setMessage(
        "The draft was rejected. Check branch scope, product status, quantities, and current version.",
      );
    } finally {
      setLoading(false);
    }
  }
  if (!profile || !hasPermission(profile, "requests.create"))
    return (
      <div className="rounded-xl border bg-white p-8">
        You do not have permission to create branch requests.
      </div>
    );
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-semibold">
          {requestId ? "Edit request draft" : "Create branch request"}
        </h1>
        <p className="text-[var(--muted)]">
          This records demand only. Saving or submitting does not reserve or
          move inventory.
        </p>
      </div>
      {message && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm">{message}</p>
      )}
      <section className="form-grid rounded-xl border bg-white p-[clamp(1rem,3vw,1.5rem)]">
        <label className="text-sm">
          Branch
          <select
            className="mt-1 w-full rounded-lg border p-2.5"
            value={selectedBranchId}
            onChange={(event) => setBranchId(event.target.value)}
          >
            <option value="">Select branch…</option>
            {allowedBranches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.code} — {branch.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Request type
          <select
            className="mt-1 w-full rounded-lg border p-2.5"
            value={requestType}
            onChange={(event) => setRequestType(event.target.value)}
          >
            {[
              "stock_replenishment",
              "customer_installation",
              "project_allocation",
              "emergency_replacement",
              "warranty_replacement",
              "inter_branch_support",
              "internal_use",
              "other",
            ].map((value) => (
              <option key={value} value={value}>
                {value.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Priority
          <select
            className="mt-1 w-full rounded-lg border p-2.5"
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
          >
            {["low", "normal", "high", "urgent", "critical"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Required date
          <input
            className="mt-1 w-full rounded-lg border p-2.5"
            type="date"
            value={requiredDate}
            onChange={(event) => setRequiredDate(event.target.value)}
          />
        </label>
        <label className="text-sm md:col-span-2">
          Purpose
          <textarea
            className="mt-1 min-h-24 w-full rounded-lg border p-2.5"
            value={purpose}
            onChange={(event) => setPurpose(event.target.value)}
          />
        </label>
        <label className="text-sm">
          Project reference
          <input
            className="mt-1 w-full rounded-lg border p-2.5"
            value={projectReference}
            onChange={(event) => setProjectReference(event.target.value)}
          />
        </label>
        <label className="text-sm">
          Customer reference
          <input
            className="mt-1 w-full rounded-lg border p-2.5"
            value={customerReference}
            onChange={(event) => setCustomerReference(event.target.value)}
          />
        </label>
        <label className="text-sm">
          Warranty reference
          <input
            className="mt-1 w-full rounded-lg border p-2.5"
            value={warrantyReference}
            onChange={(event) => setWarrantyReference(event.target.value)}
          />
        </label>
        <div className="rounded-lg bg-slate-50 p-3 text-sm text-[var(--muted)]">
          Supporting-document metadata is reserved. Binary uploads remain
          disabled until the Storage security workflow is approved.
        </div>
      </section>
      <section className="space-y-3 rounded-xl border bg-white p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Requested products</h2>
          <Button
            variant="secondary"
            onClick={() => setLines((current) => [...current, emptyLine()])}
          >
            <Plus className="mr-2 size-4" />
            Add line
          </Button>
        </div>
        {lines.map((line, index) => (
          <div
            key={index}
            className="grid gap-3 rounded-lg border p-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,11rem),1fr))]"
          >
            <select
              className="rounded-lg border p-2.5"
              value={line.productId}
              onChange={(event) =>
                setLines((current) =>
                  current.map((item, itemIndex) =>
                    itemIndex === index
                      ? { ...item, productId: event.target.value }
                      : item,
                  ),
                )
              }
            >
              <option value="">Select active product…</option>
              {products.data
                .filter((product) => product.active)
                .map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.sku} — {product.name} ({product.trackingType})
                  </option>
                ))}
            </select>
            <input
              aria-label="Requested quantity"
              className="rounded-lg border p-2.5"
              type="number"
              min="1"
              value={line.requestedQuantity}
              onChange={(event) =>
                setLines((current) =>
                  current.map((item, itemIndex) =>
                    itemIndex === index
                      ? {
                          ...item,
                          requestedQuantity: Number(event.target.value),
                        }
                      : item,
                  ),
                )
              }
            />
            <input
              aria-label="Requester note"
              className="rounded-lg border p-2.5"
              placeholder="Item note"
              value={line.requesterNote}
              onChange={(event) =>
                setLines((current) =>
                  current.map((item, itemIndex) =>
                    itemIndex === index
                      ? { ...item, requesterNote: event.target.value }
                      : item,
                  ),
                )
              }
            />
            <Button
              variant="ghost"
              disabled={lines.length === 1}
              onClick={() =>
                setLines((current) =>
                  current.filter((_, itemIndex) => itemIndex !== index),
                )
              }
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
      </section>
      <Button disabled={loading} onClick={save}>
        {loading && <Loader2 className="mr-2 size-4 animate-spin" />}Save draft
      </Button>
    </div>
  );
}

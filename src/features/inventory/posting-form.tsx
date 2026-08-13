"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import { useOrganizationCollection } from "@/features/administration/use-organization-collection";
import { useAuth } from "@/features/auth/auth-context";
import { hasPermission } from "@/lib/permissions/roles";
import { parseSerialText, SerialNumberInput } from "./serial-number-input";
import type { InventoryLocation, PermissionId, Product } from "@/types/domain";
const schema = z.object({
  productId: z.string().min(1),
  sourceLocationId: z.string().optional(),
  destinationLocationId: z.string().optional(),
  locationId: z.string().optional(),
  quantity: z.coerce.number().int().positive(),
  unitCostMinor: z.coerce.number().int().nonnegative().optional(),
  effectiveAt: z.string().min(1),
  reason: z.string().min(3),
  referenceNumber: z.string().optional(),
  serialText: z.string(),
  lotNumber: z.string().optional(),
  direction: z.enum(["increase", "decrease"]),
  adjustmentType: z.enum([
    "increase",
    "decrease",
    "damage",
    "loss",
    "found_stock",
    "data_correction",
  ]),
});
type Values = z.input<typeof schema>;
type ParsedValues = z.output<typeof schema>;
const defaults: Values = {
  productId: "",
  sourceLocationId: "",
  destinationLocationId: "",
  locationId: "",
  quantity: 1,
  unitCostMinor: 0,
  effectiveAt: new Date().toISOString().slice(0, 16),
  reason: "",
  referenceNumber: "",
  serialText: "",
  lotNumber: "",
  direction: "increase",
  adjustmentType: "data_correction",
};
const config = {
  receipt: {
    title: "Manual inventory receipt",
    callable: "postInventoryReceipt",
    permission: "inventory.receive",
  },
  opening: {
    title: "Opening stock",
    callable: "postOpeningStock",
    permission: "inventory.opening_stock",
  },
  movement: {
    title: "Internal location movement",
    callable: "moveInventoryBetweenLocations",
    permission: "inventory.move_internal",
  },
  adjustment: {
    title: "Controlled stock adjustment",
    callable: "postStockAdjustment",
    permission: "inventory.adjust",
  },
} as const satisfies Record<
  string,
  { title: string; callable: string; permission: PermissionId }
>;
export function PostingForm({ mode }: { mode: keyof typeof config }) {
  const { profile } = useAuth();
  const products = useOrganizationCollection<Product>("products");
  const locations =
    useOrganizationCollection<InventoryLocation>("inventoryLocations");
  const [message, setMessage] = useState<string | null>(null);
  const form = useForm<Values, unknown, ParsedValues>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
  });
  const productId = useWatch({ control: form.control, name: "productId" });
  const quantity = useWatch({ control: form.control, name: "quantity" });
  const product = products.data.find((item) => item.id === productId);
  const submit = form.handleSubmit(async (values) => {
    const serials = parseSerialText(values.serialText);
    if (
      serials.duplicates.length ||
      (product?.trackingType === "serial" &&
        serials.values.length !== values.quantity)
    ) {
      setMessage("Serial numbers must be unique and equal the quantity.");
      return;
    }
    try {
      const shared = {
        productId: values.productId,
        quantity: values.quantity,
        effectiveAt: new Date(values.effectiveAt).toISOString(),
        reason: values.reason,
        referenceNumber: values.referenceNumber || undefined,
        serialNumbers: serials.values,
        idempotencyKey: crypto.randomUUID(),
      };
      const lot =
        product?.trackingType === "batch"
          ? { lotNumber: values.lotNumber }
          : undefined;
      const payload =
        mode === "movement"
          ? {
              ...shared,
              sourceLocationId: values.sourceLocationId,
              destinationLocationId: values.destinationLocationId,
              lotNumber:
                product?.trackingType === "batch"
                  ? values.lotNumber
                  : undefined,
            }
          : mode === "adjustment"
            ? {
                ...shared,
                locationId: values.locationId,
                direction: values.direction,
                adjustmentType: values.adjustmentType,
                unitCostMinor:
                  values.direction === "increase"
                    ? values.unitCostMinor
                    : undefined,
                lot,
              }
            : {
                ...shared,
                destinationLocationId: values.destinationLocationId,
                unitCostMinor: values.unitCostMinor,
                externalAccount: mode === "opening" ? "migration" : "supplier",
                lot,
              };
      const result = await callAdministration<
        object,
        { transactionNumber: string; posted: boolean }
      >(config[mode].callable, payload);
      setMessage(
        `${result.posted ? "Posted" : "Already posted"} as ${result.transactionNumber}.`,
      );
      form.reset(defaults);
    } catch {
      setMessage(
        "Posting was rejected. Check permissions, stock, scope, tracking data, and costs.",
      );
    }
  });
  const locationOptions = locations.data.filter(
    (item) => item.status === "active",
  );
  if (!profile || !hasPermission(profile, config[mode].permission))
    return (
      <div className="rounded-xl border bg-white p-8">
        <h1 className="text-2xl font-semibold">{config[mode].title}</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          You do not have permission to use this posting workflow.
        </p>
      </div>
    );
  return (
    <form onSubmit={submit} className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-3xl font-semibold">{config[mode].title}</h1>
        <p className="text-[var(--muted)]">
          All effects post atomically through the immutable inventory ledger.
        </p>
      </div>
      {message && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm">{message}</p>
      )}
      <div className="form-grid rounded-xl border bg-white p-[clamp(1rem,3vw,1.5rem)]">
        <label className="text-sm">
          Product
          <select
            {...form.register("productId")}
            className="mt-1 w-full rounded-lg border p-2.5"
          >
            <option value="">Select product…</option>
            {products.data
              .filter((item) => item.active)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.sku} — {item.name}
                </option>
              ))}
          </select>
        </label>
        {mode === "movement" ? (
          <>
            <label className="text-sm">
              Source location
              <select
                {...form.register("sourceLocationId")}
                className="mt-1 w-full rounded-lg border p-2.5"
              >
                <option value="">Select…</option>
                {locationOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Destination location
              <select
                {...form.register("destinationLocationId")}
                className="mt-1 w-full rounded-lg border p-2.5"
              >
                <option value="">Select…</option>
                {locationOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : mode === "adjustment" ? (
          <label className="text-sm">
            Location
            <select
              {...form.register("locationId")}
              className="mt-1 w-full rounded-lg border p-2.5"
            >
              <option value="">Select…</option>
              {locationOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="text-sm">
            Destination location
            <select
              {...form.register("destinationLocationId")}
              className="mt-1 w-full rounded-lg border p-2.5"
            >
              <option value="">Select…</option>
              {locationOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="text-sm">
          Quantity
          <input
            type="number"
            {...form.register("quantity")}
            className="mt-1 w-full rounded-lg border p-2.5"
          />
        </label>
        {mode !== "movement" && (
          <label className="text-sm">
            Unit cost (kobo)
            <input
              type="number"
              {...form.register("unitCostMinor")}
              disabled={
                mode === "adjustment" &&
                form.getValues("direction") === "decrease"
              }
              className="mt-1 w-full rounded-lg border p-2.5"
            />
          </label>
        )}
        {mode === "adjustment" && (
          <>
            <label className="text-sm">
              Direction
              <select
                {...form.register("direction")}
                className="mt-1 w-full rounded-lg border p-2.5"
              >
                <option>increase</option>
                <option>decrease</option>
              </select>
            </label>
            <label className="text-sm">
              Adjustment type
              <select
                {...form.register("adjustmentType")}
                className="mt-1 w-full rounded-lg border p-2.5"
              >
                {[
                  "increase",
                  "decrease",
                  "damage",
                  "loss",
                  "found_stock",
                  "data_correction",
                ].map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
          </>
        )}
        <label className="text-sm">
          Effective date
          <input
            type="datetime-local"
            {...form.register("effectiveAt")}
            className="mt-1 w-full rounded-lg border p-2.5"
          />
        </label>
        <label className="text-sm">
          Reference
          <input
            {...form.register("referenceNumber")}
            className="mt-1 w-full rounded-lg border p-2.5"
          />
        </label>
        {product?.trackingType === "batch" && (
          <label className="text-sm">
            Lot number
            <input
              {...form.register("lotNumber")}
              className="mt-1 w-full rounded-lg border p-2.5"
            />
          </label>
        )}
        {product?.trackingType === "serial" && (
          <Controller
            control={form.control}
            name="serialText"
            render={({ field }) => (
              <SerialNumberInput
                value={field.value}
                onChange={field.onChange}
                expected={typeof quantity === "number" ? quantity : undefined}
              />
            )}
          />
        )}
        <label className="text-sm md:col-span-2">
          Reason
          <textarea
            {...form.register("reason")}
            className="mt-1 w-full rounded-lg border p-2.5"
          />
        </label>
        <div className="md:col-span-2">
          <Button disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting
              ? "Posting…"
              : "Post immutable transaction"}
          </Button>
        </div>
      </div>
    </form>
  );
}

"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import { useOrganizationCollection } from "@/features/administration/use-organization-collection";
import { useAuth } from "@/features/auth/auth-context";
import { formatNaira, nairaToKobo } from "@/features/inventory/format";
import { hasPermission } from "@/lib/permissions/roles";
import { openingStockUnitCost } from "./posting-form-calculations";
import { parseSerialText, SerialNumberInput } from "./serial-number-input";
import type {
  Branch,
  InventoryLocation,
  PermissionId,
  Product,
  Warehouse,
} from "@/types/domain";

interface ProductCost {
  id: string;
  productId: string;
  defaultUnitCostMinor: number;
}
const schema = z.object({
  productId: z.string().min(1, "Select a product."),
  sourceLocationId: z.string().optional(),
  destinationLocationId: z.string().optional(),
  locationId: z.string().optional(),
  quantity: z.coerce
    .number()
    .int("Enter a whole-number quantity.")
    .positive("Quantity must be at least 1."),
  unitCostNaira: z
    .number()
    .nonnegative()
    .refine(
      (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6,
      "Enter no more than two decimal places.",
    )
    .optional(),
  effectiveAt: z.string().min(1),
  reason: z.string().min(3, "Enter a short reason."),
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
  unitCostNaira: undefined,
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
export function PostingForm({
  mode,
  initialProductId,
}: {
  mode: keyof typeof config;
  initialProductId?: string;
}) {
  const { profile } = useAuth();
  const products = useOrganizationCollection<Product>("products");
  const productCosts = useOrganizationCollection<ProductCost>(
    "productCosts",
    profile ? hasPermission(profile, "inventory.cost.read") : false,
  );
  const locations =
    useOrganizationCollection<InventoryLocation>("inventoryLocations");
  const branches = useOrganizationCollection<Branch>("branches");
  const warehouses = useOrganizationCollection<Warehouse>("warehouses");
  const [message, setMessage] = useState<string | null>(null);
  const [openingDestinationType, setOpeningDestinationType] = useState<
    "warehouse" | "branch"
  >("warehouse");
  const form = useForm<Values, unknown, ParsedValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      ...defaults,
      productId: initialProductId ?? "",
      reason: mode === "opening" ? "Initial stock setup" : "",
    },
  });
  const productId = useWatch({ control: form.control, name: "productId" });
  const quantity = useWatch({ control: form.control, name: "quantity" });
  const product = products.data.find((item) => item.id === productId);
  const configuredUnitCostMinor = productCosts.data.find(
    (item) => item.productId === productId || item.id === productId,
  )?.defaultUnitCostMinor ?? product?.defaultUnitCostMinor;
  const locationOptions = locations.data.filter(
    (item) => item.status === "active",
  );
  const openingWarehouseOptions = locationOptions.filter(
    (item) => item.type === "warehouse",
  );
  const openingBranchOptions = locationOptions.filter(
    (item) => item.type === "branch",
  );
  const canManageLocations = profile
    ? hasPermission(profile, "location.manage")
    : false;
  const warehousesWithoutLocations = canManageLocations
    ? warehouses.data.filter(
        (warehouse) =>
          warehouse.status === "active" &&
          !openingWarehouseOptions.some(
            (location) => location.warehouseId === warehouse.id,
          ),
      )
    : [];
  const branchesWithoutLocations = canManageLocations
    ? branches.data.filter(
        (branch) =>
          branch.status === "active" &&
          !openingBranchOptions.some(
            (location) => location.branchId === branch.id,
          ),
      )
    : [];
  const openingDestinationOptions =
    openingDestinationType === "warehouse"
      ? openingWarehouseOptions
      : openingBranchOptions;
  const openingOwnersWithoutLocations =
    openingDestinationType === "warehouse"
      ? warehousesWithoutLocations
      : branchesWithoutLocations;
  const locationLabel = (item: InventoryLocation) => {
    const warehouse = warehouses.data.find(
      (candidate) => candidate.id === item.warehouseId,
    );
    const branch = branches.data.find(
      (candidate) => candidate.id === item.branchId,
    );
    const owner = warehouse?.name ?? branch?.name;
    return owner && owner !== item.name
      ? `${owner} — ${item.name}`
      : owner ?? item.name;
  };

  useEffect(() => {
    if (
      mode === "opening" &&
      !form.getValues("productId") &&
      products.data.filter((item) => item.active).length === 1
    )
      form.setValue(
        "productId",
        products.data.find((item) => item.active)?.id ?? "",
      );
    if (mode !== "opening" || form.getValues("destinationLocationId")) return;
    const onlyLocation = openingDestinationOptions.length === 1
      ? openingDestinationOptions.at(0)
      : undefined;
    if (onlyLocation)
      form.setValue("destinationLocationId", onlyLocation.id);
    const onlyOwnerWithoutLocation =
      openingDestinationOptions.length === 0 &&
      openingOwnersWithoutLocations.length === 1
        ? openingOwnersWithoutLocations.at(0)
        : undefined;
    if (onlyOwnerWithoutLocation)
      form.setValue(
        "destinationLocationId",
        `setup-${openingDestinationType}:${onlyOwnerWithoutLocation.id}`,
      );
  }, [
    form,
    mode,
    openingDestinationOptions,
    openingDestinationType,
    openingOwnersWithoutLocations,
    products.data,
  ]);
  const submit = form.handleSubmit(async (values) => {
    setMessage(null);
    const destinationRequired = mode === "opening" || mode === "receipt";
    if (destinationRequired && !values.destinationLocationId) {
      form.setError("destinationLocationId", {
        message: "Select where this stock will be kept.",
      });
      return;
    }
    if (mode === "movement" && !values.sourceLocationId) {
      form.setError("sourceLocationId", { message: "Select a source location." });
      return;
    }
    if (mode === "movement" && !values.destinationLocationId) {
      form.setError("destinationLocationId", {
        message: "Select a destination location.",
      });
      return;
    }
    if (mode === "adjustment" && !values.locationId) {
      form.setError("locationId", { message: "Select a location." });
      return;
    }
    if (
      (mode === "opening" &&
        configuredUnitCostMinor === undefined &&
        values.unitCostNaira === undefined) ||
      (mode === "receipt" && values.unitCostNaira === undefined)
    ) {
      form.setError("unitCostNaira", {
        message: "Enter the cost of one unit in naira.",
      });
      return;
    }
    if (product?.trackingType === "batch" && !values.lotNumber?.trim()) {
      form.setError("lotNumber", { message: "Enter the batch or lot number." });
      return;
    }
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
      let destinationLocationId = values.destinationLocationId;
      if (
        mode === "opening" &&
        destinationLocationId?.startsWith("setup-warehouse:")
      ) {
        const warehouseId = destinationLocationId.slice(
          "setup-warehouse:".length,
        );
        const warehouse = warehouses.data.find(
          (candidate) => candidate.id === warehouseId,
        );
        if (!warehouse) {
          form.setError("destinationLocationId", {
            message: "That warehouse is no longer available. Select it again.",
          });
          return;
        }
        const created = await callAdministration<
          object,
          { id: string; saved: boolean }
        >("saveInventoryLocation", {
          name: `${warehouse.name} Stock`,
          code: warehouse.code,
          type: "warehouse",
          warehouseId: warehouse.id,
          status: "active",
          systemManaged: false,
          idempotencyKey: crypto.randomUUID(),
        });
        destinationLocationId = created.id;
      }
      if (
        mode === "opening" &&
        destinationLocationId?.startsWith("setup-branch:")
      ) {
        const branchId = destinationLocationId.slice("setup-branch:".length);
        const branch = branches.data.find(
          (candidate) => candidate.id === branchId,
        );
        if (!branch) {
          form.setError("destinationLocationId", {
            message: "That store/branch is no longer available. Select it again.",
          });
          return;
        }
        const created = await callAdministration<
          object,
          { id: string; saved: boolean }
        >("saveInventoryLocation", {
          name: `${branch.name} Stock`,
          code: branch.code,
          type: "branch",
          branchId: branch.id,
          status: "active",
          systemManaged: false,
          idempotencyKey: crypto.randomUUID(),
        });
        destinationLocationId = created.id;
      }
      const enteredUnitCostMinor =
        values.unitCostNaira === undefined
          ? undefined
          : nairaToKobo(values.unitCostNaira);
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
              destinationLocationId,
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
                    ? enteredUnitCostMinor
                    : undefined,
                lot,
              }
            : {
                ...shared,
                destinationLocationId,
                unitCostMinor:
                  mode === "opening"
                    ? openingStockUnitCost(
                        configuredUnitCostMinor,
                        enteredUnitCostMinor,
                      )
                    : enteredUnitCostMinor,
                externalAccount: mode === "opening" ? "migration" : "supplier",
                lot,
              };
      const result = await callAdministration<
        object,
        { transactionNumber: string; posted: boolean }
      >(config[mode].callable, payload);
      setMessage(
        result.posted
          ? `Stock added successfully. Reference: ${result.transactionNumber}.`
          : `This stock was already added. Reference: ${result.transactionNumber}.`,
      );
      form.reset({
        ...defaults,
        productId: initialProductId ?? "",
        reason: mode === "opening" ? "Initial stock setup" : "",
      });
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Stock could not be added. Review the highlighted fields and try again.",
      );
    }
  });
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
        <h1 className="text-3xl font-semibold">
          {mode === "opening" ? "Add initial stock" : config[mode].title}
        </h1>
        <p className="text-[var(--muted)]">
          {mode === "opening"
            ? "Record stock already held by the business in a warehouse or store/branch."
            : "Record the inventory movement securely."}
        </p>
      </div>
      {message && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm">{message}</p>
      )}
      {mode === "opening" && (
        <aside className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
          <strong>Opening balance:</strong> choose whether the stock is already
          in a warehouse or already in a store/branch, then select the place and
          enter the quantity. Future movements between them use transfers.
        </aside>
      )}
      <div className="form-grid rounded-xl border bg-white p-[clamp(1rem,3vw,1.5rem)]">
        <label className="text-sm">
          {mode === "opening" ? "1. Product" : "Product"}
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
          {form.formState.errors.productId?.message && (
            <span className="mt-1 block text-xs text-red-700">
              {form.formState.errors.productId.message}
            </span>
          )}
        </label>
        {mode === "opening" && (
          <label className="text-sm">
            2. Where is this stock now?
            <select
              value={openingDestinationType}
              onChange={(event) => {
                setOpeningDestinationType(
                  event.target.value as "warehouse" | "branch",
                );
                form.setValue("destinationLocationId", "");
                form.clearErrors("destinationLocationId");
              }}
              className="mt-1 w-full rounded-lg border p-2.5"
            >
              <option value="warehouse">Warehouse</option>
              <option value="branch">Store / branch</option>
            </select>
          </label>
        )}
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
            {mode === "opening"
              ? `3. ${openingDestinationType === "warehouse" ? "Warehouse" : "Store / branch"}`
              : "Destination location"}
            <select
              {...form.register("destinationLocationId")}
              className="mt-1 w-full rounded-lg border p-2.5"
            >
              <option value="">
                {mode === "opening"
                  ? `Select ${openingDestinationType === "warehouse" ? "warehouse" : "store / branch"}…`
                  : "Select…"}
              </option>
              {(mode === "opening" ? openingDestinationOptions : locationOptions).map((item) => (
                <option key={item.id} value={item.id}>
                  {mode === "opening" ? locationLabel(item) : item.name}
                </option>
              ))}
              {mode === "opening" && openingOwnersWithoutLocations.length > 0 && (
                <optgroup label={`${openingDestinationType === "warehouse" ? "Warehouses" : "Stores / branches"} ready for automatic stock setup`}>
                  {openingOwnersWithoutLocations.map((owner) => (
                    <option
                      key={owner.id}
                      value={`setup-${openingDestinationType}:${owner.id}`}
                    >
                      {owner.name} (set up automatically)
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            {form.formState.errors.destinationLocationId?.message && (
              <span className="mt-1 block text-xs text-red-700">
                {form.formState.errors.destinationLocationId.message}
              </span>
            )}
            {mode === "opening" &&
              !locations.loading &&
              openingDestinationOptions.length === 0 &&
              openingOwnersWithoutLocations.length === 0 && (
              <span className="mt-2 block text-xs text-amber-800">
                No available {openingDestinationType === "warehouse" ? "warehouse" : "store/branch"} was found.
                {canManageLocations ? (
                  <>
                    {" "}
                    <Link
                      className="font-semibold underline"
                      href={openingDestinationType === "warehouse" ? "/administration/warehouses" : "/administration/branches"}
                    >
                      Create one first
                    </Link>
                    .
                  </>
                ) : (
                  ` Ask an administrator to configure your assigned ${openingDestinationType === "warehouse" ? "warehouse" : "store/branch"}.`
                )}
              </span>
            )}
          </label>
        )}
        <label className="text-sm">
          {mode === "opening" ? `4. Quantity${product ? ` (${product.unitOfMeasure})` : ""}` : "Quantity"}
          <input
            type="number"
            {...form.register("quantity")}
            className="mt-1 w-full rounded-lg border p-2.5"
          />
          {form.formState.errors.quantity?.message && (
            <span className="mt-1 block text-xs text-red-700">
              {form.formState.errors.quantity.message}
            </span>
          )}
        </label>
        {mode === "opening" && configuredUnitCostMinor !== undefined ? (
          <div className="rounded-lg border bg-slate-50 p-3 text-sm">
            <span className="block text-[var(--muted)]">
              Unit cost from product
            </span>
            <strong className="mt-1 block text-base">
              {formatNaira(configuredUnitCostMinor)} per {product?.unitOfMeasure}
            </strong>
            <span className="mt-1 block text-xs text-[var(--muted)]">
              Reused automatically; no re-entry required.
            </span>
          </div>
        ) : mode !== "movement" ? (
          <label className="text-sm">
            {mode === "opening"
              ? "Unit cost (₦ — no product default configured)"
              : "Unit cost (₦)"}
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              placeholder="0.00"
              {...form.register("unitCostNaira", {
                setValueAs: (value) =>
                  value === "" ? undefined : Number(value),
              })}
              disabled={
                mode === "adjustment" &&
                form.getValues("direction") === "decrease"
              }
              className="mt-1 w-full rounded-lg border p-2.5"
            />
            {form.formState.errors.unitCostNaira?.message && (
              <span className="mt-1 block text-xs text-red-700">
                {form.formState.errors.unitCostNaira.message}
              </span>
            )}
          </label>
        ) : null}
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
        {mode !== "opening" && (
          <>
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
          </>
        )}
        {product?.trackingType === "batch" && (
          <label className="text-sm">
            Batch / lot number
            <input
              {...form.register("lotNumber")}
              className="mt-1 w-full rounded-lg border p-2.5"
            />
            <span className="mt-1 block text-xs text-[var(--muted)]">
              Required because this product is tracked by batch.
            </span>
            {form.formState.errors.lotNumber?.message && (
              <span className="mt-1 block text-xs text-red-700">
                {form.formState.errors.lotNumber.message}
              </span>
            )}
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
        {mode === "opening" ? (
          <details className="rounded-lg border p-3 md:col-span-2">
            <summary className="cursor-pointer text-sm font-semibold">
              Optional record details
            </summary>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <label className="text-sm">
                Stock date
                <input type="datetime-local" {...form.register("effectiveAt")} className="mt-1 w-full rounded-lg border p-2.5" />
              </label>
              <label className="text-sm">
                Reference (optional)
                <input {...form.register("referenceNumber")} className="mt-1 w-full rounded-lg border p-2.5" />
              </label>
              <label className="text-sm md:col-span-2">
                Reason
                <textarea {...form.register("reason")} className="mt-1 w-full rounded-lg border p-2.5" />
              </label>
            </div>
          </details>
        ) : (
          <label className="text-sm md:col-span-2">
            Reason
            <textarea {...form.register("reason")} className="mt-1 w-full rounded-lg border p-2.5" />
          </label>
        )}
        <div className="md:col-span-2">
          <Button disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting
              ? "Adding stock…"
              : mode === "opening"
                ? "Add stock to inventory"
                : "Save inventory record"}
          </Button>
        </div>
      </div>
    </form>
  );
}

"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { useDialogFocus } from "@/components/ui/use-dialog-focus";
import { callAdministration } from "@/features/administration/api";
import { useOrganizationCollection } from "@/features/administration/use-organization-collection";
import { useAuth } from "@/features/auth/auth-context";
import { formatNaira } from "@/features/inventory/format";
import { hasPermission } from "@/lib/permissions/roles";
import {
  productTrackingTypes,
  type Product,
  type ProductCategory,
} from "@/types/domain";

const schema = z.object({
  name: z.string().min(2),
  sku: z
    .string()
    .trim()
    .max(40)
    .refine(
      (value) => value === "" || (value.length >= 2 && /^[A-Za-z0-9 _.-]+$/.test(value)),
      "Enter a valid SKU or leave it blank for automatic generation.",
    ),
  categoryName: z.string().trim().max(120).optional(),
  brand: z.string().optional(),
  model: z.string().optional(),
  description: z.string().optional(),
  unitOfMeasure: z.string().min(1),
  trackingType: z.enum(productTrackingTypes),
  minimumStockLevel: z.coerce.number().int().nonnegative().optional(),
  reorderLevel: z.coerce.number().int().nonnegative().optional(),
  defaultUnitCostMinor: z.coerce.number().int().nonnegative().optional(),
  active: z.boolean(),
});
type Values = z.input<typeof schema>;
type ParsedValues = z.output<typeof schema>;
const defaults: Values = {
  name: "",
  sku: "",
  categoryName: "",
  brand: "",
  model: "",
  description: "",
  unitOfMeasure: "unit",
  trackingType: "quantity",
  active: true,
};
export default function ProductsPage() {
  const { profile } = useAuth();
  const products = useOrganizationCollection<Product>("products");
  const categories =
    useOrganizationCollection<ProductCategory>("productCategories");
  const [search, setSearch] = useState("");
  const [tracking, setTracking] = useState("");
  const [editing, setEditing] = useState<Product | null>(null);
  const [open, setOpen] = useState(false);
  const dialogRef = useDialogFocus<HTMLFormElement>(open, () => setOpen(false));
  const [message, setMessage] = useState<string | null>(null);
  const canCreate = profile ? hasPermission(profile, "products.create") : false;
  const canUpdate = profile ? hasPermission(profile, "products.update") : false;
  const form = useForm<Values, unknown, ParsedValues>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
  });
  const filtered = useMemo(
    () =>
      products.data.filter(
        (product) =>
          (!search ||
            `${product.name} ${product.sku} ${product.brand ?? ""}`
              .toLowerCase()
              .includes(search.toLowerCase())) &&
          (!tracking || product.trackingType === tracking),
      ),
    [products.data, search, tracking],
  );
  function edit(product?: Product) {
    setEditing(product ?? null);
    form.reset(
      product
        ? {
            name: product.name,
            sku: product.sku,
            categoryName:
              product.categoryName ??
              categories.data.find((category) => category.id === product.categoryId)
                ?.name ??
              "",
            brand: product.brand ?? "",
            model: product.model ?? "",
            description: product.description ?? "",
            unitOfMeasure: product.unitOfMeasure,
            trackingType: product.trackingType,
            minimumStockLevel: product.minimumStockLevel,
            reorderLevel: product.reorderLevel,
            defaultUnitCostMinor: product.defaultUnitCostMinor,
            active: product.active,
          }
        : defaults,
    );
    setOpen(true);
  }
  const submit = form.handleSubmit(async (values) => {
    try {
      const clean = Object.fromEntries(
        Object.entries(values).filter(
          ([, value]) =>
            value !== "" &&
            value !== undefined &&
            !(typeof value === "number" && Number.isNaN(value)),
        ),
      );
      const categoryName = values.categoryName?.trim();
      const existingCategory = categories.data.find(
        (category) =>
          category.active &&
          category.name.toLocaleLowerCase() ===
            categoryName?.toLocaleLowerCase(),
      );
      await callAdministration("saveProduct", {
        ...clean,
        ...(existingCategory
          ? { categoryId: existingCategory.id }
          : categoryName
            ? { categoryName }
            : {}),
        ...(editing ? { id: editing.id } : {}),
        idempotencyKey: crypto.randomUUID(),
      });
      setOpen(false);
      setMessage("Product saved securely.");
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "The product could not be saved. Review the form and try again.",
      );
    }
  });
  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Product catalogue</h1>
          <p className="text-[var(--muted)]">
            Organization SKUs and tracking policies.
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => edit()}>
            <Plus className="mr-2 size-4" />
            Create product
          </Button>
        )}
      </div>
      <div className="grid gap-3 rounded-xl border bg-white p-4 md:grid-cols-2">
        <label className="relative">
          <Search className="absolute left-3 top-3 size-4 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, SKU, or brand"
            className="w-full rounded-lg border py-2.5 pl-9 pr-3"
          />
        </label>
        <select
          value={tracking}
          onChange={(event) => setTracking(event.target.value)}
          className="rounded-lg border px-3"
        >
          <option value="">All tracking types</option>
          {productTrackingTypes.map((type) => (
            <option key={type}>{type}</option>
          ))}
        </select>
      </div>
      {message && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm">{message}</p>
      )}
      <div className="responsive-table-wrap">
        <table className="responsive-table">
          <thead className="bg-slate-50">
            <tr>
              {[
                "Product",
                "SKU",
                "Tracking",
                "Unit",
                "Default cost",
                "Status",
                "",
              ].map((label) => (
                <th key={label} className="px-4 py-3">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {products.loading ? (
              <tr>
                <td colSpan={7} className="p-8 text-center">
                  Loading…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-[var(--muted)]">
                  No products found.
                </td>
              </tr>
            ) : (
              filtered.map((product) => (
                <tr key={product.id} className="border-t">
                  <td data-label="Product" data-primary="true" className="px-4 py-3">
                    <Link
                      href={`/products/${product.id}`}
                      className="font-semibold text-[var(--brand)]"
                    >
                      {product.name}
                    </Link>
                    <span className="block text-xs text-[var(--muted)]">
                      {product.brand} {product.model}
                    </span>
                  </td>
                  <td data-label="SKU" className="px-4 font-mono">{product.sku}</td>
                  <td data-label="Tracking" className="px-4 capitalize">{product.trackingType}</td>
                  <td data-label="Unit" className="px-4">{product.unitOfMeasure}</td>
                  <td data-label="Default cost" className="px-4">
                    {formatNaira(product.defaultUnitCostMinor)}
                  </td>
                  <td data-label="Status" className="px-4">
                    <StatusBadge tone={product.active ? "success" : "warning"}>
                      {product.active ? "active" : "inactive"}
                    </StatusBadge>
                  </td>
                  <td data-label="Actions" data-actions="true" className="px-4">
                    {canUpdate && (
                      <Button variant="ghost" onClick={() => edit(product)}>
                        Edit
                      </Button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/50 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Product editor">
          <form
            ref={dialogRef}
            onSubmit={submit}
            className="safe-bottom max-h-[calc(100dvh-1rem)] w-full max-w-2xl space-y-4 overflow-y-auto rounded-t-2xl bg-white p-5 sm:my-8 sm:rounded-2xl sm:p-6"
          >
            <h2 className="text-xl font-semibold">
              {editing ? "Edit product" : "Create product"}
            </h2>
            <div className="form-grid">
              <label className="text-sm">
                Name
                <input
                  {...form.register("name")}
                  className="mt-1 w-full rounded-lg border p-2.5"
                />
              </label>
              <label className="text-sm">
                SKU (optional)
                <input
                  {...form.register("sku")}
                  placeholder="Generated automatically if blank"
                  className="mt-1 w-full rounded-lg border p-2.5 font-mono uppercase"
                />
                <span className="mt-1 block text-xs text-[var(--muted)]">
                  Enter your own SKU or leave this blank.
                </span>
              </label>
              <label className="text-sm">
                Category
                <input
                  {...form.register("categoryName")}
                  list="product-category-options"
                  placeholder="Select or type a new category"
                  className="mt-1 w-full rounded-lg border p-2.5"
                />
                <datalist id="product-category-options">
                  {categories.data
                    .filter((category) => category.active)
                    .map((category) => (
                      <option key={category.id} value={category.name} />
                    ))}
                </datalist>
                <span className="mt-1 block text-xs text-[var(--muted)]">
                  A new category is created automatically when needed.
                </span>
              </label>
              <label className="text-sm">
                Tracking
                <select
                  {...form.register("trackingType")}
                  disabled={Boolean(editing?.hasLedgerActivity)}
                  className="mt-1 w-full rounded-lg border p-2.5"
                >
                  {productTrackingTypes.map((type) => (
                    <option key={type}>{type}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                Brand
                <input
                  {...form.register("brand")}
                  className="mt-1 w-full rounded-lg border p-2.5"
                />
              </label>
              <label className="text-sm">
                Model
                <input
                  {...form.register("model")}
                  className="mt-1 w-full rounded-lg border p-2.5"
                />
              </label>
              <label className="text-sm">
                Unit of measure
                <input
                  {...form.register("unitOfMeasure")}
                  className="mt-1 w-full rounded-lg border p-2.5"
                />
              </label>
              <label className="text-sm">
                Default cost (kobo)
                <input
                  type="number"
                  {...form.register("defaultUnitCostMinor")}
                  className="mt-1 w-full rounded-lg border p-2.5"
                />
              </label>
              <label className="text-sm">
                Minimum stock
                <input
                  type="number"
                  {...form.register("minimumStockLevel")}
                  className="mt-1 w-full rounded-lg border p-2.5"
                />
              </label>
              <label className="text-sm">
                Reorder level
                <input
                  type="number"
                  {...form.register("reorderLevel")}
                  className="mt-1 w-full rounded-lg border p-2.5"
                />
              </label>
              <label className="text-sm md:col-span-2">
                Description
                <textarea
                  {...form.register("description")}
                  className="mt-1 w-full rounded-lg border p-2.5"
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" {...form.register("active")} />
                Active
              </label>
            </div>
            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button disabled={form.formState.isSubmitting}>
                Save securely
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

"use client";
import { AmountInput } from "@/components/ui/amount-input";
import { FinancialInput, FinancialMessage, FinancialText, FinancialValue } from "@/features/finance/financial-privacy";

import { zodResolver } from "@hookform/resolvers/zod";
import { matchesProductName } from "@/features/products/name-search";
import { ChevronDown, Plus, Search } from "lucide-react";
import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { AppDialog } from "@/components/ui/app-dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  PaginatedTableControls,
  useTablePagination,
} from "@/components/ui/table-pagination";
import { useDialogFocus } from "@/components/ui/use-dialog-focus";
import { callAdministration } from "@/features/administration/api";
import { useOrganizationCollection } from "@/features/administration/use-organization-collection";
import { useAuth } from "@/features/auth/auth-context";
import { hasOrganizationWideOperatingAccess } from "@/features/auth/operating-context";
import { useLocationProductMembership } from "@/features/inventory/use-location-inventory";
import {
  formatNaira,
  koboToNaira,
  nairaToKobo,
} from "@/features/inventory/format";
import { hasPermission } from "@/lib/permissions/roles";
import { useBranchPriceColumns } from "@/features/products/branch-price-columns";
import { MarginReview } from "@/features/products/margin-review";
import { BranchPrices } from "@/features/products/branch-prices";
import { CatalogImportDialog } from "@/features/products/catalog-import-dialog";
import { ProductHistoryPreview } from "@/features/reports/product-history-preview";
import {
  productTrackingTypes,
  type Product,
  type ProductCategory,
  type InventoryLocation,
} from "@/types/domain";

const schema = z.object({
  itemKind: z.enum(["stock", "service"]),
  name: z.string().min(2),
  sku: z
    .string()
    .trim()
    .max(40)
    .refine(
      (value) =>
        value === "" || (value.length >= 2 && /^[A-Za-z0-9 _.-]+$/.test(value)),
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
  defaultUnitCostNaira: z
    .number()
    .nonnegative()
    .refine(
      (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6,
      "Enter no more than two decimal places.",
    )
    .optional(),
  baseSellingPriceNaira: z
    .number()
    .positive()
    .refine(
      (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6,
      "Enter no more than two decimal places.",
    )
    .optional(),
  vatPercent: z
    .number()
    .min(0)
    .max(100)
    .refine(
      (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6,
      "Enter no more than two decimal places.",
    )
    .optional(),
  wholesalePriceNaira: z.number().positive().refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, "Enter no more than two decimal places.").optional(),
  active: z.boolean(),
});
type Values = z.input<typeof schema>;
type ParsedValues = z.output<typeof schema>;
const defaults: Values = {
  itemKind: "stock",
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
  const { profile, operatingContext } = useAuth();
  return <ProductCatalogue key={JSON.stringify([profile?.organizationId, profile?.uid, profile?.authorizationVersion, profile?.roleId, profile?.roleIds, profile?.branchIds, profile?.warehouseIds, operatingContext])} />;
}

function ProductCatalogue() {
  const { profile, operatingContext } = useAuth();
  const branchPriceColumns = useBranchPriceColumns();
  const canReadCost = Boolean(profile && hasPermission(profile, "inventory.cost.read"));
  const catalogueColumnCount = canReadCost ? 13 : 11;
  const products = useOrganizationCollection<Product>("products");
  const categories =
    useOrganizationCollection<ProductCategory>("productCategories");
  const productCosts = useOrganizationCollection<{
    id: string;
    productId: string;
    defaultUnitCostMinor: number;
  }>(
    "productCosts",
    canReadCost,
  );
  const productSalesPrices = useOrganizationCollection<{
    id: string;
    productId: string;
    basePriceMinor: number;
    version: number;
    wholesalePriceMinor?: number | null;
    vatRateBasisPoints: number | null;
    active: boolean;
  }>("productSalesPrices");
  const canReadInventory = Boolean(profile && hasPermission(profile, "inventory.read"));
  const locations = useOrganizationCollection<InventoryLocation>("inventoryLocations", canReadInventory,
    operatingContext ? { field: operatingContext.type === "branch" ? "branchId" : "warehouseId", id: operatingContext.id } : undefined);
  const locationScoped = canReadInventory && (Boolean(operatingContext) || !profile || !hasOrganizationWideOperatingAccess(profile));
  const scopedInventory = useLocationProductMembership(locations, locationScoped);
  const localProductIds = scopedInventory.productIds;
  const loading = products.loading || scopedInventory.loading;
  const inventoryError = scopedInventory.error;
  const [showAllForPricing, setShowAllForPricing] = useState(false);
  const [pricingProduct, setPricingProduct] = useState<Product | null>(null);
  const [search, setSearch] = useState("");
  const [expandedProductId, setExpandedProductId] = useState<string | null>(null);
  const [tracking, setTracking] = useState("");
  const [editing, setEditing] = useState<Product | null>(null);
  const [open, setOpen] = useState(false);
  const dialogRef = useDialogFocus<HTMLFormElement>(open, () => setOpen(false));
  const [message, setMessage] = useState<string | null>(null);
  const canCreate = profile ? hasPermission(profile, "products.create") : false;
  const canUpdate = profile ? hasPermission(profile, "products.update") : false;
  const canManageBasePrice = profile
    ? hasPermission(profile, "sales.price.base.manage")
    : false;
  const form = useForm<Values, unknown, ParsedValues>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
  });
  const serviceItem = useWatch({ control: form.control, name: "itemKind" }) === "service";
  const [reviewCost, reviewRetail, reviewWholesale] = useWatch({ control: form.control, name: ["defaultUnitCostNaira", "baseSellingPriceNaira", "wholesalePriceNaira"] });
  const canReviewMargin = canReadCost && !productCosts.loading && !productCosts.error;
  const filtered = useMemo(
    () =>
      products.data.filter(
        (product) =>
          (!locationScoped || showAllForPricing || localProductIds.has(product.id)) &&
          matchesProductName(product.name, search) &&
          (!tracking || product.trackingType === tracking),
      ),
    [products.data, search, tracking, locationScoped, localProductIds, showAllForPricing],
  );
  const pagination = useTablePagination(filtered);
  function edit(product?: Product) {
    setEditing(product ?? null);
    const configuredCost = product
      ? productCosts.data.find(
          (cost) => cost.productId === product.id || cost.id === product.id,
        )?.defaultUnitCostMinor
      : undefined;
    const configuredPrice = product
      ? productSalesPrices.data.find(
          (price) => price.productId === product.id || price.id === product.id,
        )
      : undefined;
    form.reset(
      product
        ? {
            itemKind: product.itemKind ?? "stock",
            name: product.name,
            sku: product.sku,
            categoryName:
              product.categoryName ??
              categories.data.find(
                (category) => category.id === product.categoryId,
              )?.name ??
              "",
            brand: product.brand ?? "",
            model: product.model ?? "",
            description: product.description ?? "",
            unitOfMeasure: product.unitOfMeasure,
            trackingType: product.trackingType,
            minimumStockLevel: product.minimumStockLevel,
            reorderLevel: product.reorderLevel,
            defaultUnitCostNaira: koboToNaira(configuredCost),
            baseSellingPriceNaira: koboToNaira(configuredPrice?.basePriceMinor),
            wholesalePriceNaira: configuredPrice?.wholesalePriceMinor ? koboToNaira(configuredPrice.wholesalePriceMinor) : undefined,
            vatPercent:
              configuredPrice?.vatRateBasisPoints == null
                ? undefined
                : configuredPrice.vatRateBasisPoints / 100,
            active: product.active,
          }
        : defaults,
    );
    setOpen(true);
  }
  const submit = form.handleSubmit(async (values) => {
    try {
      const {
        defaultUnitCostNaira,
        baseSellingPriceNaira,
        wholesalePriceNaira,
        vatPercent,
        ...productValues
      } = values;
      const clean = Object.fromEntries(
        Object.entries(productValues).filter(
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
      const saved = await callAdministration<
        Record<string, unknown>,
        { productId: string; saved: boolean }
      >("saveProduct", {
        ...clean,
        ...(values.itemKind === "service" ? { trackingType: "quantity", minimumStockLevel: 0, reorderLevel: 0 } : {}),
        ...(existingCategory
          ? { categoryId: existingCategory.id }
          : categoryName
            ? { categoryName }
            : {}),
        ...(editing ? { id: editing.id } : {}),
        ...(values.itemKind === "service" ? { defaultUnitCostMinor: 0 } : defaultUnitCostNaira !== undefined
          ? { defaultUnitCostMinor: nairaToKobo(defaultUnitCostNaira) }
          : {}),
        idempotencyKey: crypto.randomUUID(),
      });
      if (canManageBasePrice && baseSellingPriceNaira !== undefined) {
        await callAdministration("saveProductSalesPrice", {
          productId: saved.productId,
          basePriceMinor: nairaToKobo(baseSellingPriceNaira),
          wholesalePriceMinor: wholesalePriceNaira === undefined ? null : nairaToKobo(wholesalePriceNaira),
          vatRateBasisPoints: vatPercent === undefined ? null : Math.round(vatPercent * 100),
          active: true,
          idempotencyKey: crypto.randomUUID(),
        });
      }
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
      {pricingProduct && (() => { const price = productSalesPrices.data.find(item => item.productId === pricingProduct.id); return <BranchPrices key={pricingProduct.id} productId={pricingProduct.id} productName={pricingProduct.name} marginCost={pricingProduct.itemKind !== "service" && canReviewMargin ? { available: true, unitCostNaira: (() => { const cost = productCosts.data.find(row => row.productId === pricingProduct.id || row.id === pricingProduct.id)?.defaultUnitCostMinor; return cost == null ? undefined : cost / 100; })() } : undefined} central={price?.active ? { basePriceMinor: price.basePriceMinor, wholesalePriceMinor: price.wholesalePriceMinor, version: price.version, vatRateBasisPoints: price.vatRateBasisPoints } : null} onClose={() => setPricingProduct(null)} />; })()}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">Product catalogue</h1>
          <p className="text-[var(--muted)]">
            <FinancialText>{operatingContext && canReadInventory ? "Products with inventory history at the selected Store/Warehouse, including zero stock." : canReadInventory && !locationScoped ? "All locations · Organization product catalogue and tracking policies." : "Organization product catalogue and tracking policies."}</FinancialText>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={scopedInventory.refresh}>Refresh catalogue</Button>
        {canCreate && (
          <div className="flex flex-wrap gap-2">
            <CatalogImportDialog
              onImported={(count, stockedRows) => {
                if (stockedRows && locationScoped) scopedInventory.refresh();
                setMessage(
                  `${count} product${count === 1 ? " was" : "s were"} imported securely.${stockedRows ? ` Opening stock posted for ${stockedRows} product${stockedRows === 1 ? "" : "s"}.` : ""}`,
                );
              }}
            />
            <Button onClick={() => edit()}>
              <Plus className="mr-2 size-4" />
              Create product
            </Button>
          </div>
        )}
        </div>
      </div>
      {locationScoped && profile && hasPermission(profile, "sales.price.branch.manage") && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showAllForPricing} onChange={event => { setShowAllForPricing(event.target.checked); pagination.setPage(1); }} />Show all catalogue items to configure branch prices, including items with no local stock</label>}
      <div className="grid gap-3 rounded-xl border bg-white p-4 md:grid-cols-2">
        <label className="relative">
          <Search className="absolute left-3 top-3 size-4 text-slate-400" />
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              pagination.setPage(1);
            }}
            aria-label="Search product name"
            placeholder="Search product name"
            className="w-full rounded-lg border py-2.5 pl-9 pr-3"
          />
        </label>
        <select
          value={tracking}
          onChange={(event) => {
            setTracking(event.target.value);
            pagination.setPage(1);
          }}
          className="rounded-lg border px-3"
        >
          <option value="">All tracking types</option>
          {productTrackingTypes.map((type) => (
            <option key={type}><FinancialText>{type}</FinancialText></option>
          ))}
        </select>
      </div>
      {message && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm"><FinancialMessage>{message}</FinancialMessage></p>
      )}
      {inventoryError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800"><FinancialText>{inventoryError}</FinancialText></p>}
      {canReadCost && <p className="text-sm text-[var(--muted)]">
        Estimated gross margins use catalogue default cost and each branch’s effective selling price before VAT: (selling price − cost) ÷ selling price × 100. These are not posted profit; inventory costs may differ. Unknown means a cost or price is missing or invalid. Zero catalogue cost and services have no meaningful estimate.
      </p>}
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
                "Central retail",
                "Central VAT",
                "Branch retail",
                ...(canReadCost ? ["Retail margin"] : []),
                "Branch wholesale",
                ...(canReadCost ? ["Wholesale margin"] : []),
                "Status",
                "",
              ].map((label) => (
                <th key={label} className="px-4 py-3">
                  <FinancialText>{label}</FinancialText>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={catalogueColumnCount} className="p-8 text-center">
                  Loading…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={catalogueColumnCount} className="p-8 text-center text-[var(--muted)]">
                  <FinancialText>{inventoryError ? "Inventory could not be loaded." : operatingContext && canReadInventory && !search && !tracking ? "No products with inventory history at this location." : "No products found."}</FinancialText>
                </td>
              </tr>
            ) : (
              pagination.rows.map((product) => (
                <Fragment key={product.id}>
                <tr className="border-t">
                  <td
                    data-label="Product"
                    data-primary="true"
                    className="px-4 py-3"
                  >
                    {product.itemKind === "service" ? <Link href="/aftersales" className="font-semibold text-[var(--brand)] underline"><FinancialText>{product.name}</FinancialText></Link> : canReadInventory ? <button
                      type="button"
                      aria-expanded={expandedProductId === product.id}
                      aria-controls={`product-history-preview-${product.id}`}
                      onClick={() => setExpandedProductId((current) => current === product.id ? null : product.id)}
                      className="inline-flex items-center gap-1.5 text-left font-semibold text-[var(--brand)] underline underline-offset-2"
                    ><FinancialText>{product.name}</FinancialText><ChevronDown className={`size-4 shrink-0 transition-transform ${expandedProductId === product.id ? "rotate-180" : ""}`} aria-hidden="true" /></button> : <Link href={`/products/${product.id}`} className="font-semibold text-[var(--brand)]"><FinancialText>{product.name}</FinancialText></Link>}
                    <span className="block text-xs text-[var(--muted)]">
                      <FinancialText>{product.brand}</FinancialText> <FinancialText>{product.model}</FinancialText>
                    </span>
                  </td>
                  <td data-label="SKU" className="px-4 font-mono">
                    <FinancialText>{product.sku}</FinancialText>
                  </td>
                  <td data-label="Tracking" className="px-4 capitalize">
                    <FinancialText>{product.itemKind === "service" ? "Service (no stock)" : product.trackingType}</FinancialText>
                  </td>
                  <td data-label="Unit" className="px-4">
                    <FinancialText>{product.unitOfMeasure}</FinancialText>
                  </td>
                  <td data-label="Default cost" className="px-4">
                    <FinancialValue>{!canReadCost ? "Restricted" : productCosts.loading ? "Loading…" : productCosts.error ? "Unable to load" : (() => {
                      const cost = productCosts.data.find(row => row.productId === product.id || row.id === product.id)?.defaultUnitCostMinor;
                      return cost === undefined || !Number.isSafeInteger(cost) || cost < 0 ? "Unknown" : formatNaira(cost);
                    })()}</FinancialValue>
                  </td>
                  <td data-label="Central retail" className="px-4">
                    <FinancialValue>{productSalesPrices.loading ? "Loading…" : productSalesPrices.error ? "Unable to load" : (() => {
                      const price = productSalesPrices.data.find(price => price.productId === product.id || price.id === product.id);
                      return price ? formatNaira(price.basePriceMinor) : "Not configured";
                    })()}</FinancialValue>
                  </td>
                  <td data-label="Central VAT" className="px-4">
                    <FinancialValue>{(() => {
                      const rate = productSalesPrices.data.find(
                        (price) =>
                          price.productId === product.id ||
                          price.id === product.id,
                      )?.vatRateBasisPoints;
                      return productSalesPrices.loading ? "Loading…" : productSalesPrices.error ? "Unable to load" : rate == null ? "Not provided" : `${rate / 100}%`;
                    })()}</FinancialValue>
                  </td>
                  {(["retail", "wholesale"] as const).map(tier => {
                    const central = productSalesPrices.data.find(price => price.productId === product.id || price.id === product.id) ?? null;
                    const centralStatus = productSalesPrices.loading ? "loading" : productSalesPrices.error ? "error" : undefined;
                    return <Fragment key={tier}>
                      <td data-label={`Branch ${tier}`} className="px-4 py-3">{branchPriceColumns.price(product.id, central, tier, centralStatus)}</td>
                      {canReadCost && <td data-label={`${tier === "retail" ? "Retail" : "Wholesale"} margin`} className="px-4 py-3">{branchPriceColumns.margin(product.id, central, tier, {
                        unitCostMinor: productCosts.data.find(cost => cost.productId === product.id || cost.id === product.id)?.defaultUnitCostMinor,
                        loading: productCosts.loading,
                        error: productCosts.error,
                        service: product.itemKind === "service",
                      }, centralStatus)}</td>}
                    </Fragment>;
                  })}
                  <td data-label="Status" className="px-4">
                    <StatusBadge tone={product.active ? "success" : "warning"}>
                      {product.active ? "active" : "inactive"}
                    </StatusBadge>
                  </td>
                  <td data-label="Actions" data-actions="true" className="px-4">
                    {profile && hasPermission(profile, "sales.price.branch.manage") && product.active && <Button disabledReason={productSalesPrices.data.some(price => price.productId === product.id && !price.active) ? "Central pricing is inactive. Reactivate it before configuring branch prices." : undefined} variant="ghost" onClick={() => setPricingProduct(product)}>Branch prices</Button>}
                    {canUpdate && (
                      <Button variant="ghost" onClick={() => edit(product)}>
                        Edit
                      </Button>
                    )}
                  </td>
                </tr>
                {expandedProductId === product.id && canReadInventory && <tr id={`product-history-preview-${product.id}`}><td colSpan={catalogueColumnCount} className="p-2 sm:p-3"><ProductHistoryPreview locationIds={locationScoped ? locations.data.filter((location) => operatingContext?.type === "branch" ? location.branchId === operatingContext.id : operatingContext?.type === "warehouse" && location.warehouseId === operatingContext.id).map((location) => location.id) : undefined} productId={product.id} productName={product.name} locations={Object.fromEntries(locations.data.map((location) => [location.id, location.name]))} reportRow={{}} /></td></tr>}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
      {!loading && !inventoryError && filtered.length > 0 && (
        <PaginatedTableControls
          pagination={pagination}
          total={filtered.length}
          itemLabel="products"
        />
      )}
      {open && (
        <AppDialog
          role="dialog"
          aria-modal="true"
          aria-label="Product editor"
        >
          <form
            ref={dialogRef}
            onSubmit={submit}
            className="app-dialog-panel safe-bottom max-w-2xl space-y-4 rounded-2xl bg-white p-5 sm:p-6"
          >
            <h2 className="text-xl font-semibold">
              <FinancialText>{editing ? "Edit product" : "Create product"}</FinancialText>
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
                  aria-label="Tracking"
                  {...form.register("trackingType")}
                  disabled={serviceItem || Boolean(editing?.hasLedgerActivity)}
                  className="mt-1 w-full rounded-lg border p-2.5"
                >
                  {productTrackingTypes.map((type) => (
                    <option key={type}><FinancialText>{type}</FinancialText></option>
                  ))}
                </select>
                {(serviceItem || editing?.hasLedgerActivity) && <span className="mt-1 block text-xs text-[var(--muted)]"><FinancialText>{serviceItem ? "Services have no physical stock tracking. Record the service fee and linked costs through their service workflows." : "Tracking is fixed because this product has recorded stock activity. Ask the inventory/catalogue manager to review the original evidence; do not change tracking to bypass history."}</FinancialText></span>}
              </label>
              <label className="text-sm">Catalogue item type<select {...form.register("itemKind")} disabled={Boolean(editing)} className="mt-1 w-full rounded-lg border p-2.5"><option value="stock">Stocked goods</option><option value="service">Service — no physical stock</option></select><span className="mt-1 block text-xs text-[var(--muted)]">Services use aftersales cases and linked costs. Item type cannot be changed after creation.</span></label>
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
                Default unit cost (₦)
                <Controller control={form.control} name="defaultUnitCostNaira" render={({ field }) => (<FinancialInput><AmountInput
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="Not provided"
                  aria-label="Default unit cost (₦)"
                  name={field.name} ref={field.ref} onBlur={field.onBlur} value={field.value} onValueChange={value => field.onChange(value === "" ? undefined : Number(value))}
                  disabled={serviceItem}
                  className="mt-1 w-full rounded-lg border p-2.5"
                /></FinancialInput>)} />
              {serviceItem && <span className="mt-1 block text-xs text-[var(--muted)]">Services do not have a physical stock unit cost; use the approved service charge and linked cost workflows.</span>}
              </label>
              {canManageBasePrice && (
                <>
                  <label className="text-sm">
                    Retail selling price (₦)
                    <Controller control={form.control} name="baseSellingPriceNaira" render={({ field }) => (<FinancialInput><AmountInput
                      type="number"
                      min="0.01"
                      step="0.01"
                      inputMode="decimal"
                      placeholder="Not provided"
                      name={field.name} ref={field.ref} onBlur={field.onBlur} value={field.value} onValueChange={value => field.onChange(value === "" ? undefined : Number(value))}
                      className="mt-1 w-full rounded-lg border p-2.5"
                    /></FinancialInput>)} />
                    <span className="mt-1 block text-xs text-[var(--muted)]">
                      Branches may sell above this. A lower price needs
                      administrator approval.
                    </span>
                  </label>
                  <label className="text-sm">
                    Wholesale selling price (₦, optional)
                    <Controller control={form.control} name="wholesalePriceNaira" render={({ field }) => (<FinancialInput><AmountInput type="number" min="0.01" step="0.01" inputMode="decimal"
                      name={field.name} ref={field.ref} onBlur={field.onBlur} value={field.value} onValueChange={value => field.onChange(value === "" ? undefined : Number(value))}
                      className="mt-1 w-full rounded-lg border p-2.5" /></FinancialInput>)} />
                    <span className="mt-1 block text-xs text-[var(--muted)]">An approved catalogue price. Leave empty to disable wholesale pricing.</span>
                  </label>
                  <label className="text-sm">
                    VAT rate (%, optional)
                    <FinancialInput><input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      inputMode="decimal"
                      placeholder="Not provided"
                      {...form.register("vatPercent", {
                        setValueAs: (value) =>
                          value === "" ? undefined : Number(value),
                      })}
                      className="mt-1 w-full rounded-lg border p-2.5"
                    /></FinancialInput>
                    <span className="mt-1 block text-xs text-[var(--muted)]">
                      Leave blank for VAT not provided; no VAT will be added. Enter 0 only for an explicitly configured zero rate.
                    </span>
                  </label>
                </>
              )}
              {!serviceItem && canManageBasePrice && <MarginReview cost={{ available: canReviewMargin, unitCostNaira: reviewCost }} retail={reviewRetail} wholesale={reviewWholesale} />}
              <label className="text-sm">
                Minimum stock
                <input
                  type="number"
                  aria-label="Minimum stock" {...form.register("minimumStockLevel")}
                  disabled={serviceItem}
                  className="mt-1 w-full rounded-lg border p-2.5"
                />
              {serviceItem && <span className="mt-1 block text-xs text-[var(--muted)]">Minimum stock does not apply to a non-stock service.</span>}
              </label>
              <label className="text-sm">
                Reorder level
                <input
                  type="number"
                  aria-label="Reorder level" {...form.register("reorderLevel")}
                  disabled={serviceItem}
                  className="mt-1 w-full rounded-lg border p-2.5"
                />
              {serviceItem && <span className="mt-1 block text-xs text-[var(--muted)]">Reorder stock level does not apply to a non-stock service.</span>}
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
        </AppDialog>
      )}
    </div>
  );
}

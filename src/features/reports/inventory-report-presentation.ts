export interface InventoryReportLookups {
  products: Readonly<Record<string, string>>;
  locations: Readonly<Record<string, string>>;
  branches: Readonly<Record<string, string>>;
  warehouses: Readonly<Record<string, string>>;
}

const hiddenKeys = new Set(["organizationId"]);
const productKeys = new Set(["productId", "productName", "sku"]);

function reference(value: unknown, label: string) {
  const text = String(value ?? "");
  return text ? `${label} …${text.slice(-8)}` : "";
}

function productLabel(
  row: Record<string, unknown>,
  lookups: InventoryReportLookups,
) {
  const id = String(row.productId ?? "");
  const known = lookups.products[id];
  if (known) return known;
  const parts = [row.sku, row.productName].filter(Boolean).map(String);
  return parts.length ? parts.join(" — ") : reference(id, "Product");
}

const identifierPresentation: Readonly<
  Record<
    string,
    {
      key: string;
      label: string;
      lookup?: keyof Omit<InventoryReportLookups, "products">;
      companion?: string;
    }
  >
> = {
  locationId: { key: "location", label: "Location", lookup: "locations" },
  currentLocationId: {
    key: "currentLocation",
    label: "Location",
    lookup: "locations",
  },
  sourceLocationId: {
    key: "sourceLocation",
    label: "Location",
    lookup: "locations",
  },
  destinationLocationId: {
    key: "destinationLocation",
    label: "Location",
    lookup: "locations",
  },
  originLocationId: {
    key: "originLocation",
    label: "Location",
    lookup: "locations",
  },
  branchId: { key: "branch", label: "Branch", lookup: "branches" },
  sourceBranchId: {
    key: "sourceBranch",
    label: "Branch",
    lookup: "branches",
  },
  destinationBranchId: {
    key: "destinationBranch",
    label: "Branch",
    lookup: "branches",
  },
  warehouseId: {
    key: "warehouse",
    label: "Warehouse",
    lookup: "warehouses",
  },
  originWarehouseId: {
    key: "originWarehouse",
    label: "Warehouse",
    lookup: "warehouses",
  },
  sourceWarehouseId: {
    key: "sourceWarehouse",
    label: "Warehouse",
    lookup: "warehouses",
  },
  destinationWarehouseId: {
    key: "destinationWarehouse",
    label: "Warehouse",
    lookup: "warehouses",
  },
  transactionId: {
    key: "transaction",
    label: "Transaction",
    companion: "transactionNumber",
  },
  lastTransactionId: {
    key: "lastTransaction",
    label: "Transaction",
  },
  stockCountId: { key: "stockCount", label: "Stock count" },
  lotId: { key: "lot", label: "Lot", companion: "lotNumber" },
  serializedItemId: {
    key: "serialItem",
    label: "Serial",
    companion: "serialNumber",
  },
};

const userIdentifierKeys = new Set([
  "createdBy",
  "updatedBy",
  "postedBy",
  "countedBy",
  "reviewedBy",
  "approvedBy",
  "reversedBy",
]);

export function humanizeInventoryReportRows(
  rows: readonly Record<string, unknown>[],
  lookups: InventoryReportLookups,
) {
  return rows.map((row) => {
    const result: Record<string, unknown> = {};
    if (row.productId) result.product = productLabel(row, lookups);

    const naturalReference = [
      row.transactionNumber,
      row.serialNumber,
      row.lotNumber,
      row.stockCountNumber,
      row.sku,
    ].some(Boolean);
    if (row.id && !naturalReference)
      result.recordReference = reference(row.id, "Record");

    for (const [key, value] of Object.entries(row)) {
      if (
        hiddenKeys.has(key) ||
        key === "id" ||
        (row.productId && productKeys.has(key))
      )
        continue;

      const presentation = identifierPresentation[key];
      if (presentation) {
        const mapped = presentation.lookup
          ? lookups[presentation.lookup][String(value ?? "")]
          : undefined;
        result[presentation.key] =
          mapped ||
          (presentation.companion && row[presentation.companion]
            ? row[presentation.companion]
            : reference(value, presentation.label));
        continue;
      }
      if (
        Object.values(identifierPresentation).some(
          (item) =>
            item.companion === key && row[`${item.key}Id`] !== undefined,
        )
      )
        continue;
      if (userIdentifierKeys.has(key)) {
        result[key] = reference(value, "User");
        continue;
      }
      if (key.endsWith("Id")) {
        result[`${key.slice(0, -2)}Reference`] = reference(value, "Reference");
        continue;
      }
      result[key] = value;
    }
    return result;
  });
}

export function inventoryReportColumnLabel(column: string) {
  return column
    .replace(/Minor$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

export function formatInventoryReportValue(column: string, value: unknown) {
  if (value === null || value === undefined) return "—";
  if (column.endsWith("Minor") && typeof value === "number")
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value / 100);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) &&
    !Number.isNaN(Date.parse(value))
  )
    return new Date(value).toLocaleString("en-NG");
  if (typeof value === "object") return JSON.stringify(value);
  if (column === "status")
    return String(value)
      .replaceAll("_", " ")
      .replace(/^./, (letter) => letter.toUpperCase());
  return String(value);
}

export function readableInventoryCsvRows(
  rows: readonly Record<string, unknown>[],
) {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        inventoryReportColumnLabel(key),
        formatInventoryReportValue(key, value),
      ]),
    ),
  );
}

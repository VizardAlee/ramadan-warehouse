export const catalogImportFields = [
  {
    key: "name",
    label: "Product name",
    required: true,
    aliases: ["name", "product", "product name", "item", "item name"],
  },
  {
    key: "sku",
    label: "SKU",
    required: false,
    aliases: ["sku", "product sku", "item code", "stock code"],
  },
  {
    key: "categoryName",
    label: "Category",
    required: false,
    aliases: ["category", "category name", "product category"],
  },
  {
    key: "brand",
    label: "Brand",
    required: false,
    aliases: ["brand", "manufacturer", "make"],
  },
  {
    key: "model",
    label: "Model",
    required: false,
    aliases: ["model", "model number", "model no"],
  },
  {
    key: "description",
    label: "Description",
    required: false,
    aliases: ["description", "details", "product description"],
  },
  {
    key: "unitOfMeasure",
    label: "Unit of measure",
    required: true,
    aliases: ["unit of measure", "unit", "uom", "measure"],
  },
  {
    key: "trackingType",
    label: "Tracking type",
    required: true,
    aliases: ["tracking type", "tracking", "inventory tracking"],
  },
  {
    key: "defaultUnitCostNaira",
    label: "Default unit cost (₦)",
    required: false,
    aliases: ["default unit cost", "unit cost", "cost", "cost naira"],
  },
  {
    key: "baseSellingPriceNaira",
    label: "Central base selling price (₦)",
    required: false,
    aliases: [
      "central base selling price",
      "base selling price",
      "selling price",
      "price",
    ],
  },
  {
    key: "vatPercent",
    label: "VAT rate (%)",
    required: false,
    aliases: ["vat rate", "vat", "vat percent", "tax rate"],
  },
  {
    key: "minimumStockLevel",
    label: "Minimum stock",
    required: false,
    aliases: ["minimum stock", "minimum stock level", "min stock"],
  },
  {
    key: "reorderLevel",
    label: "Reorder level",
    required: false,
    aliases: ["reorder level", "reorder point", "restock level"],
  },
  {
    key: "active",
    label: "Active",
    required: false,
    aliases: ["active", "status", "enabled"],
  },
] as const;

export type CatalogImportField = (typeof catalogImportFields)[number]["key"];
export type CatalogColumnMapping = Record<CatalogImportField, number | null>;

export interface CatalogImportTable {
  headers: string[];
  rows: string[][];
}

function normalizeHeader(value: string) {
  return value
    .trim()
    .toLocaleLowerCase()
    .replaceAll("₦", " naira ")
    .replaceAll("%", " percent ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function autoMapCatalogColumns(headers: readonly string[]) {
  const mapping = Object.fromEntries(
    catalogImportFields.map((field) => [field.key, null]),
  ) as CatalogColumnMapping;
  const used = new Set<number>();
  for (const field of catalogImportFields) {
    const aliases = new Set([
      normalizeHeader(field.key),
      normalizeHeader(field.label),
      ...field.aliases.map(normalizeHeader),
    ]);
    const index = headers.findIndex(
      (header, column) => !used.has(column) && aliases.has(normalizeHeader(header)),
    );
    if (index >= 0) {
      mapping[field.key] = index;
      used.add(index);
    }
  }
  return mapping;
}

export function parseCatalogCsv(csv: string): CatalogImportTable {
  const parsed: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index]!;
    if (character === '"') {
      if (quoted && csv[index + 1] === '"') {
        field += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(field.trim());
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && csv[index + 1] === "\n") index += 1;
      row.push(field.trim());
      if (row.some(Boolean)) parsed.push(row);
      row = [];
      field = "";
    } else field += character;
  }
  if (quoted) throw new Error("The CSV contains an unfinished quoted value.");
  row.push(field.trim());
  if (row.some(Boolean)) parsed.push(row);
  return tableFromRows(parsed);
}

export function tableFromRows(rows: readonly (readonly unknown[])[]) {
  const values = rows.map((row) =>
    row.map((cell) => (cell == null ? "" : String(cell).trim())),
  );
  const headers = values[0] ?? [];
  if (headers.length === 0 || headers.every((header) => !header))
    throw new Error("The file does not contain a header row.");
  if (headers.some((header) => !header))
    throw new Error("Every imported column must have a heading.");
  if (new Set(headers.map(normalizeHeader)).size !== headers.length)
    throw new Error("Every imported column must have a unique heading.");
  const dataRows = values.slice(1).filter((row) => row.some(Boolean));
  if (dataRows.length === 0) throw new Error("The file does not contain product rows.");
  if (dataRows.length > 500)
    throw new Error("Import at most 500 products at a time.");
  return { headers, rows: dataRows } satisfies CatalogImportTable;
}

function quoteCsv(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

export function mappedCatalogCsv(
  table: CatalogImportTable,
  mapping: CatalogColumnMapping,
) {
  const missing = catalogImportFields.filter(
    (field) => field.required && mapping[field.key] === null,
  );
  if (missing.length)
    throw new Error(
      `Map the required ${missing.map((field) => field.label).join(", ")} column${missing.length === 1 ? "" : "s"}.`,
    );
  const selected = Object.entries(mapping).filter((entry) => entry[1] !== null);
  const duplicateSources = selected
    .map(([, column]) => column)
    .filter((column, index, columns) => columns.indexOf(column) !== index);
  if (duplicateSources.length)
    throw new Error("Each imported column can map to only one system field.");
  const headers = catalogImportFields.map((field) => field.key);
  const lines = table.rows.map((row) =>
    catalogImportFields
      .map((field) => {
        const column = mapping[field.key];
        return quoteCsv(column === null ? "" : (row[column] ?? ""));
      })
      .join(","),
  );
  return [headers.join(","), ...lines].join("\n");
}

export function catalogTemplateCsv() {
  return [
    catalogImportFields.map((field) => field.label).join(","),
    [
      "620W Solar Panel",
      "",
      "Solar Panels",
      "Jinko",
      "JKM620",
      "Bifacial solar panel",
      "unit",
      "serial",
      "125000.00",
      "165000.00",
      "7.50",
      "5",
      "10",
      "true",
    ]
      .map(quoteCsv)
      .join(","),
  ].join("\n");
}

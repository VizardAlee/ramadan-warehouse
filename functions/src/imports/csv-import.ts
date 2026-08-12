import { z } from "zod";

export type CsvImportKind = "products" | "opening_stock" | "serial_numbers";
export interface CsvRowError { row: number; field: string; code: string; message: string }
export interface CsvPreview<T extends Record<string, string> = Record<string, string>> {
  kind: CsvImportKind;
  valid: boolean;
  totalRows: number;
  validRows: T[];
  errors: CsvRowError[];
}
export interface CsvValidationContext {
  existingSkus?: ReadonlySet<string>;
  existingSerials?: ReadonlySet<string>;
  productTracking?: ReadonlyMap<string, "quantity" | "batch" | "serial">;
  locationIds?: ReadonlySet<string>;
}

export function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < csv.length; index++) {
    const character = csv[index]!;
    if (character === '"') {
      if (quoted && csv[index + 1] === '"') { field += '"'; index++; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) { row.push(field.trim()); field = ""; }
    else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && csv[index + 1] === "\n") index++;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = []; field = "";
    } else field += character;
  }
  if (quoted) throw new Error("CSV_UNTERMINATED_QUOTE");
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

const productRow = z.object({
  sku: z.string().trim().min(2).max(40),
  name: z.string().trim().min(2).max(180),
  unitOfMeasure: z.string().trim().min(1).max(40),
  trackingType: z.enum(["quantity", "batch", "serial"]),
  categoryId: z.string().trim().optional(),
  defaultUnitCostMinor: z.string().regex(/^\d+$/),
});
const openingRow = z.object({
  productId: z.string().trim().min(1),
  locationId: z.string().trim().min(1),
  quantity: z.string().regex(/^\d+$/).refine((value) => Number(value) > 0),
  unitCostMinor: z.string().regex(/^\d+$/),
  serialNumbers: z.string().optional(),
  lotNumber: z.string().optional(),
});
const serialRow = z.object({
  productId: z.string().trim().min(1),
  locationId: z.string().trim().min(1),
  serialNumber: z.string().trim().min(1).max(160),
  unitCostMinor: z.string().regex(/^\d+$/),
});

const requiredHeaders: Record<CsvImportKind, readonly string[]> = {
  products: ["sku", "name", "unitOfMeasure", "trackingType", "defaultUnitCostMinor"],
  opening_stock: ["productId", "locationId", "quantity", "unitCostMinor"],
  serial_numbers: ["productId", "locationId", "serialNumber", "unitCostMinor"],
};

export function previewCsvImport(kind: CsvImportKind, csv: string, context: CsvValidationContext = {}): CsvPreview {
  if (new TextEncoder().encode(csv).length > 1_000_000) throw new Error("CSV_TOO_LARGE");
  const parsed = parseCsv(csv);
  if (parsed.length > 501) throw new Error("CSV_ROW_LIMIT_EXCEEDED");
  const headers = parsed[0] ?? [];
  const missing = requiredHeaders[kind].filter((header) => !headers.includes(header));
  if (missing.length) return { kind, valid: false, totalRows: Math.max(0, parsed.length - 1), validRows: [], errors: missing.map((field) => ({ row: 1, field, code: "MISSING_HEADER", message: `Required header ${field} is missing.` })) };
  const schema = kind === "products" ? productRow : kind === "opening_stock" ? openingRow : serialRow;
  const errors: CsvRowError[] = [];
  const validRows: Record<string, string>[] = [];
  const seenSkus = new Set<string>();
  const seenSerials = new Set<string>();
  for (let index = 1; index < parsed.length; index++) {
    const values = parsed[index]!;
    const candidate = Object.fromEntries(headers.map((header, column) => [header, values[column] ?? ""]));
    const result = schema.safeParse(candidate);
    if (!result.success) {
      for (const issue of result.error.issues) errors.push({ row: index + 1, field: issue.path.join("."), code: "INVALID_VALUE", message: issue.message });
      continue;
    }
    const value = result.data as Record<string, string>;
    if (kind === "products") {
      const sku = value.sku!.trim().toUpperCase();
      if (seenSkus.has(sku) || context.existingSkus?.has(sku)) errors.push({ row: index + 1, field: "sku", code: "DUPLICATE_SKU", message: "SKU already exists in this file or organization." });
      else seenSkus.add(sku);
    } else {
      if (context.locationIds && !context.locationIds.has(value.locationId!)) errors.push({ row: index + 1, field: "locationId", code: "INVALID_LOCATION", message: "Location does not belong to the organization." });
      const tracking = context.productTracking?.get(value.productId!);
      if (!tracking) errors.push({ row: index + 1, field: "productId", code: "INVALID_PRODUCT", message: "Product does not belong to the organization." });
      if (kind === "opening_stock") {
        if (tracking === "serial" && !value.serialNumbers) errors.push({ row: index + 1, field: "serialNumbers", code: "SERIALS_REQUIRED", message: "Serial-tracked opening stock requires serial numbers." });
        if (tracking === "serial" && value.serialNumbers && value.serialNumbers.split("|").filter(Boolean).length !== Number(value.quantity)) errors.push({ row: index + 1, field: "serialNumbers", code: "SERIAL_COUNT_MISMATCH", message: "Serial count must equal quantity." });
        if (tracking === "batch" && !value.lotNumber) errors.push({ row: index + 1, field: "lotNumber", code: "LOT_REQUIRED", message: "Batch-tracked opening stock requires a lot number." });
      } else {
        const serial = value.serialNumber!.trim().toUpperCase();
        if (tracking !== "serial") errors.push({ row: index + 1, field: "productId", code: "TRACKING_TYPE_MISMATCH", message: "Serial import requires a serial-tracked product." });
        if (seenSerials.has(serial) || context.existingSerials?.has(serial)) errors.push({ row: index + 1, field: "serialNumber", code: "DUPLICATE_SERIAL", message: "Serial already exists in this file or organization." });
        else seenSerials.add(serial);
      }
    }
    if (!errors.some((error) => error.row === index + 1)) validRows.push(value);
  }
  return { kind, valid: errors.length === 0, totalRows: Math.max(0, parsed.length - 1), validRows, errors };
}

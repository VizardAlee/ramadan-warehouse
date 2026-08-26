"use client";

import {
  ArrowRight,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useDialogFocus } from "@/components/ui/use-dialog-focus";
import { callAdministration } from "@/features/administration/api";
import {
  autoMapCatalogColumns,
  catalogImportFields,
  catalogTemplateCsv,
  mappedCatalogCsv,
  parseCatalogCsv,
  tableFromRows,
  type CatalogColumnMapping,
  type CatalogImportTable,
} from "./catalog-import";

interface ImportError {
  row: number;
  field: string;
  code: string;
  message: string;
}

interface ImportPreview {
  valid: boolean;
  totalRows: number;
  validRows: Record<string, string>[];
  errors: ImportError[];
}

interface ImportResult {
  importId: string;
  imported: boolean;
  summary: { totalRows: number; imported: number; failed: number };
}

function downloadText(filename: string, value: string) {
  const url = URL.createObjectURL(
    new Blob([value], { type: "text/csv;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function CatalogImportDialog({
  onImported,
}: {
  onImported(count: number): void;
}) {
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [table, setTable] = useState<CatalogImportTable | null>(null);
  const [mapping, setMapping] = useState<CatalogColumnMapping | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useDialogFocus<HTMLDivElement>(open, close);

  function resetFile() {
    setFileName("");
    setTable(null);
    setMapping(null);
    setPreview(null);
    setMessage(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function close() {
    setOpen(false);
    resetFile();
  }

  async function readFile(file: File) {
    setLoading(true);
    setMessage(null);
    setPreview(null);
    try {
      if (file.size > 5_000_000)
        throw new Error("Choose a file no larger than 5 MB.");
      const extension = file.name.split(".").at(-1)?.toLocaleLowerCase();
      let nextTable: CatalogImportTable;
      if (extension === "csv") {
        nextTable = parseCatalogCsv(await file.text());
      } else if (extension === "xlsx") {
        const { readSheet } = await import("read-excel-file/browser");
        nextTable = tableFromRows(await readSheet(file));
      } else {
        throw new Error("Use a CSV or Excel .xlsx file.");
      }
      setFileName(file.name);
      setTable(nextTable);
      setMapping(autoMapCatalogColumns(nextTable.headers));
    } catch (cause) {
      resetFile();
      setMessage(
        cause instanceof Error ? cause.message : "The file could not be read.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function validate() {
    if (!table || !mapping) return;
    setLoading(true);
    setMessage(null);
    setPreview(null);
    try {
      const csv = mappedCatalogCsv(table, mapping);
      if (new TextEncoder().encode(csv).length > 1_000_000)
        throw new Error("The mapped catalogue exceeds the 1 MB import limit.");
      const result = await callAdministration<
        { kind: "products"; csv: string },
        ImportPreview
      >("previewCsvImport", { kind: "products", csv });
      setPreview(result);
      setMessage(
        result.valid
          ? `${result.totalRows} product row${result.totalRows === 1 ? " is" : "s are"} ready to import.`
          : "Resolve the listed file errors before importing.",
      );
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "The catalogue could not be validated.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function confirmImport() {
    if (!table || !mapping || !preview?.valid) return;
    setLoading(true);
    setMessage(null);
    try {
      const result = await callAdministration<
        {
          kind: "products";
          csv: string;
          idempotencyKey: string;
        },
        ImportResult
      >("confirmCsvImport", {
        kind: "products",
        csv: mappedCatalogCsv(table, mapping),
        idempotencyKey: crypto.randomUUID(),
      });
      onImported(result.summary.imported);
      close();
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "The catalogue import could not be completed.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Upload className="mr-2 size-4" />
        Import catalogue
      </Button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/50 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="catalogue-import-title"
        >
          <div
            ref={dialogRef}
            className="safe-bottom max-h-[calc(100dvh-1rem)] w-full max-w-5xl overflow-y-auto rounded-t-2xl bg-white p-5 sm:my-8 sm:rounded-2xl sm:p-6"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[.14em] text-[var(--brand)]">
                  Guided import
                </p>
                <h2 id="catalogue-import-title" className="mt-1 text-2xl font-semibold">
                  Import product catalogue
                </h2>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--muted)]">
                  Upload CSV or Excel (.xlsx), match your headings to the system
                  fields, validate every row, then confirm the import.
                </p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={close}
                aria-label="Close catalogue import"
              >
                <X />
              </Button>
            </div>

            <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
              <label className="flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-emerald-200 bg-emerald-50/50 p-5 text-center hover:border-emerald-400">
                {loading && !table ? (
                  <Loader2 className="mb-2 size-7 animate-spin text-[var(--brand)]" />
                ) : (
                  <FileSpreadsheet className="mb-2 size-7 text-[var(--brand)]" />
                )}
                <span className="font-semibold">
                  {fileName || "Choose CSV or Excel file"}
                </span>
                <span className="mt-1 text-xs text-[var(--muted)]">
                  Header row required · up to 500 products · 5 MB file limit
                </span>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void readFile(file);
                  }}
                />
              </label>
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  downloadText("abr-product-catalogue-template.csv", catalogTemplateCsv())
                }
              >
                <Download className="mr-2 size-4" />
                Download template
              </Button>
            </div>

            {table && mapping && (
              <>
                <section className="mt-6 rounded-xl border bg-slate-50 p-4 sm:p-5">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold">Map your columns</h3>
                      <p className="mt-1 text-sm text-[var(--muted)]">
                        We matched familiar headings automatically. Review each
                        selection; required system fields are marked.
                      </p>
                    </div>
                    <p className="text-sm font-semibold text-[var(--brand)]">
                      {table.rows.length} data rows found
                    </p>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {catalogImportFields.map((field) => (
                      <label key={field.key} className="text-sm font-medium">
                        {field.label}
                        {field.required && (
                          <span className="ml-1 text-red-700">Required</span>
                        )}
                        <select
                          value={mapping[field.key] ?? ""}
                          onChange={(event) => {
                            const value = event.target.value;
                            setMapping((current) =>
                              current
                                ? {
                                    ...current,
                                    [field.key]: value === "" ? null : Number(value),
                                  }
                                : current,
                            );
                            setPreview(null);
                          }}
                          className="mt-1 w-full rounded-lg border bg-white p-2.5"
                        >
                          <option value="">Do not import</option>
                          {table.headers.map((header, index) => (
                            <option key={`${header}-${index}`} value={index}>
                              {header}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                </section>

                <section className="mt-5">
                  <h3 className="font-semibold">Mapped preview</h3>
                  <div className="responsive-table-wrap mt-2">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50">
                        <tr>
                          {catalogImportFields
                            .filter((field) => mapping[field.key] !== null)
                            .map((field) => (
                              <th key={field.key} className="px-3 py-2 text-left">
                                {field.label}
                              </th>
                            ))}
                        </tr>
                      </thead>
                      <tbody>
                        {table.rows.slice(0, 5).map((row, rowIndex) => (
                          <tr key={rowIndex} className="border-t">
                            {catalogImportFields
                              .filter((field) => mapping[field.key] !== null)
                              .map((field) => (
                                <td key={field.key} className="max-w-64 truncate px-3 py-2">
                                  {row[mapping[field.key]!] || "—"}
                                </td>
                              ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {table.rows.length > 5 && (
                    <p className="mt-2 text-xs text-[var(--muted)]">
                      Showing the first 5 of {table.rows.length} rows.
                    </p>
                  )}
                </section>
              </>
            )}

            {message && (
              <p
                role="status"
                className={`mt-5 rounded-lg p-3 text-sm ${preview?.valid ? "bg-emerald-50 text-emerald-950" : "bg-amber-50 text-amber-950"}`}
              >
                {message}
              </p>
            )}
            {preview && preview.errors.length > 0 && (
              <section className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
                <h3 className="font-semibold text-red-950">
                  {preview.errors.length} validation issue
                  {preview.errors.length === 1 ? "" : "s"}
                </h3>
                <ul className="mt-2 max-h-44 space-y-1 overflow-y-auto text-sm text-red-900">
                  {preview.errors.slice(0, 100).map((error, index) => (
                    <li key={`${error.row}-${error.field}-${index}`}>
                      Row {error.row}: {error.field} — {error.message}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <div className="mt-6 flex flex-wrap justify-end gap-3 border-t pt-5">
              <Button type="button" variant="secondary" onClick={close}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={!table || !mapping || loading}
                onClick={() => void validate()}
              >
                {loading && <Loader2 className="mr-2 size-4 animate-spin" />}
                Validate rows
              </Button>
              <Button
                type="button"
                disabled={!preview?.valid || loading}
                onClick={() => void confirmImport()}
              >
                {loading ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : preview?.valid ? (
                  <CheckCircle2 className="mr-2 size-4" />
                ) : (
                  <ArrowRight className="mr-2 size-4" />
                )}
                Import validated products
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

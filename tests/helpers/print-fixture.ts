import { mkdirSync, writeFileSync } from "node:fs";

/** Optional real-browser print fixtures, generated only from synthetic test data. */
export function savePrintFixture(name: string) {
  const directory = process.env.INVOICE_PRINT_FIXTURE_DIR;
  if (!directory) return;
  mkdirSync(directory, { recursive: true });
  writeFileSync(`${directory}/${name}.html`, `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="invoice.css"></head><body>${document.body.innerHTML}</body></html>`);
}

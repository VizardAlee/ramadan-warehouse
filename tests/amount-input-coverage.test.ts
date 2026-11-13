import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(directory, entry.name)) : entry.name.endsWith(".tsx") ? [join(directory, entry.name)] : []);
}
it("uses the shared amount input at every financial entry site while keeping rates separate", () => {
  const amounts: string[] = [], rates: string[] = [], unexpected: string[] = [];
  for (const file of files("src")) {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function visit(node: ts.Node) {
      if (ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(source), text = node.getText(source);
        if (tag === "AmountInput") amounts.push(file);
        if (tag === "input" && ts.isJsxElement(node.parent) && node.parent.openingElement.tagName.getText(source) === "FinancialInput") {
          if (/vatPercent|draft\.rate|value=\{vat\}/.test(text)) rates.push(file);
          else unexpected.push(`${file}: ${text}`);
        }
        if (tag === "input" && /inputMode="decimal"/.test(text) && !/vatPercent|draft\.rate|value=\{vat\}/.test(text)) unexpected.push(`${file}: raw decimal input`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  expect(unexpected).toEqual([]);
  // Supplier invoice review adds one actual-price entry site in its own component.
  expect(amounts.filter(file => file === "src/features/procurement/supplier-invoice-match.tsx")).toHaveLength(1);
  expect(amounts.filter(file => file === "src/features/reconciliation/staff-advance-panel.tsx")).toHaveLength(1);
  expect(amounts).toHaveLength(48);
  expect(new Set(amounts).size).toBe(33);
  expect(rates).toHaveLength(4);
});

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
  expect(amounts).toHaveLength(46);
  expect(new Set(amounts).size).toBe(31);
  expect(rates).toHaveLength(4);
});

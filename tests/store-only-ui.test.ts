import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");

describe("store-only operating model", () => {
  it("does not expose warehouse administration or assignment controls", () => {
    const overview = source("src/app/(protected)/administration/page.tsx");
    const layout = source("src/app/(protected)/administration/layout.tsx");
    const users = source("src/app/(protected)/administration/users/page.tsx");

    expect(overview).not.toContain('["warehouses"');
    expect(layout).not.toContain("/administration/warehouses");
    expect(users).not.toContain("All warehouses");
    expect(users).not.toContain('data-label="Warehouses"');
  });

  it("offers only stores for opening stock and new transfers", () => {
    const openingStock = source("src/features/inventory/posting-form.tsx");
    const transfers = source("functions/src/callable/stock-transfers.ts");

    expect(openingStock).not.toContain('<option value="warehouse">');
    expect(openingStock).toContain("Store / Head Office");
    expect(transfers).toContain('d.get("type") === "branch"');
  });
});

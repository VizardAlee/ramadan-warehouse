import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("fluid workspace foundations", () => {
  it("loads dashboard sales independently of operations and avoids stale totals on failure", () => {
    const dashboard = source("src/app/(protected)/dashboard/page.tsx");
    expect(dashboard).toContain("void loadSalesRegister(salesBranchId)");
    expect(dashboard).toContain("setSalesLoading(false)");
    expect(dashboard).toContain("setOperationsLoading(false)");
    expect(dashboard).toContain("setSalesError(true)");
    expect(dashboard).toContain("setOperationsError(true)");
    expect(dashboard).toContain('salesError ? "—" : value');
    expect(dashboard).toContain("<ChartPlaceholder label=\"Sales trend\" />");
    expect(dashboard).toContain("<ChartPlaceholder label=\"Open work\" />");
  });

  it("uses a readable POS cart surface and motion that honors reduced-motion settings", () => {
    const pos = source("src/app/(protected)/pos/page.tsx");
    const styles = source("src/app/globals.css");
    expect(pos).toContain('className={`pos-cart-panel');
    expect(styles).toContain(".pos-cart-panel { background: #fff");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toContain(".app-dialog-panel {");
  });
});

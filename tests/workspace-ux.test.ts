import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("task-first workspaces", () => {
  it("groups permission-filtered destinations and prioritizes core mobile tasks", () => {
    const shell = source("src/components/layout/app-shell.tsx");
    expect(shell).toContain('label: "Sales & customers"');
    expect(shell).toContain('label: "Stock & movement"');
    expect(shell).toContain('label: "Money & accounts"');
    expect(shell).toContain("visibleNavigation.filter");
    expect(shell).toContain('"/dashboard", "/pos", "/transfers", "/inventory"');
    expect(shell).not.toContain("visibleNavigation.slice(0, 5)");
  });

  it("keeps mobile sale state in one cart panel without changing checkout actions", () => {
    const pos = source("src/app/(protected)/pos/page.tsx");
    expect(pos).toContain('aria-label="Point of sale workspace"');
    expect(pos).toContain('"Current sale and held sales"');
    expect(pos).toContain('cartOpen && !customerDialogOpen');
    expect(pos).toContain("void holdSale()");
    expect(pos).toContain("confirmOrderPayment(order.id)");
  });

  it("reuses the audited transfer detail action in a quick-view panel", () => {
    const transfers = source("src/features/transfers/stock-transfer-workspace.tsx");
    expect(transfers).toContain("<StockTransferDetail transferId={quickTransferId} embedded />");
    expect(transfers).toContain('aria-modal="true"');
    expect(transfers).toContain('href={`/transfers/simple/${t.id}`}');
  });
});

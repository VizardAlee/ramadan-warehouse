import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("POS customer creation", () => {
  it("creates and selects a customer without navigating away from checkout", () => {
    const page = readFileSync(
      join(process.cwd(), "src/app/(protected)/pos/page.tsx"),
      "utf8",
    );

    expect(page).toContain('>("saveCustomer", {');
    expect(page).toContain("setCustomerId(result.customerId)");
    expect(page).toContain("Your current sale is unchanged");
    expect(page).toContain("app-dialog-panel max-w-lg");
    expect(page).toContain('href="/customers" target="_blank" rel="noopener noreferrer"');
  });
});

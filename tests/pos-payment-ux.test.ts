import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("POS credit and part-payment choices", () => {
  it("exposes both paths and preserves their intent in held sales", () => {
    const page = readFileSync(join(process.cwd(), "src/app/(protected)/pos/page.tsx"), "utf8");
    const types = readFileSync(join(process.cwd(), "src/features/pos/types.ts"), "utf8");

    expect(page).toContain('["credit", "Pay later"]');
    expect(page).toContain('["part", "Part payment"]');
    expect(page).toContain("Amount paid now (₦)");
    expect(page).toContain("Balance due later");
    expect(page).toContain('creditIntent === "part" && creditPaidAmountMinor <= 0');
    expect(page).toContain("selectedCustomer.availableCreditMinor < creditAmountMinor");
    expect(types).toContain('creditIntent?: "credit" | "part"');
  });
});

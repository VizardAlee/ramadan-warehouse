import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("POS price controls", () => {
  it("makes the one-sale action prominent and distinguishes store-wide pricing", () => {
    const page = readFileSync(join(process.cwd(), "src/app/(protected)/pos/page.tsx"), "utf8");

    expect(page).toContain("Change sale price · this order only");
    expect(page).toContain('className="mt-3 w-full justify-center border-[var(--brand)] text-[var(--brand)]"');
    expect(page).toContain("Store-wide price");
    expect(page).toContain("This changes future sales at this store.");
    expect(page).toContain("setSalePriceProductId(line.product.id)");
    expect(page).toContain("<SalePriceDialog");
    const dialog = readFileSync(join(process.cwd(), "src/features/pos/sale-price-dialog.tsx"), "utf8");
    expect(dialog).toContain("You can set a higher or lower price for this order only.");
    expect(dialog).toContain('min="0.01" step="0.01" inputMode="decimal" required value={salePrice}');
    expect(dialog).toContain('<Button type="submit">Apply to sale</Button>');
  });
});

import { expect, it } from "vitest";
import { accountPosition } from "@/features/finance/account-position";
it("preserves gross balances and describes equal nonzero amounts as pending allocation", () => {
  expect(accountPosition(100, 100, "customer")).toEqual({ net: 0, label: "Net settled · allocation pending" });
  expect(accountPosition(0, 0, "customer").label).toBe("No balance recorded");
  expect(accountPosition(100, 50, "customer")).toEqual({ net: 50, label: "Customer owes company" });
  expect(accountPosition(50, 100, "customer").label).toBe("Company holds customer funds");
  expect(accountPosition(100, 50, "supplier").label).toBe("Company owes supplier");
  for (const unknown of [null, undefined, NaN, -1, Number.MAX_SAFE_INTEGER + 1]) expect(accountPosition(100, unknown, "supplier").net).toBeNull();
});

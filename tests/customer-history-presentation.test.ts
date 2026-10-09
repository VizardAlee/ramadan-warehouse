import { describe, expect, it } from "vitest";
import { customerHistoryLabel, customerHistoryTone } from "../src/features/customers/history-presentation";

describe("customer history presentation", () => {
  it("explains account effects without exposing raw entry codes", () => {
    expect(customerHistoryLabel("account", "credit_sale")).toBe("Added to amount owed");
    expect(customerHistoryLabel("account", "credit sale")).toBe("Added to amount owed");
    expect(customerHistoryLabel("account", "payment")).toBe("Payment received");
    expect(customerHistoryLabel("account", "sale_return_credit")).toBe("Return credited to account");
    expect(customerHistoryLabel("account", "advance_refund")).toBe("Unused advance refunded");
  });

  it("uses attention for debt, green for payment, red for returns and blue for sales", () => {
    expect(customerHistoryTone("account", "credit_sale")).toBe("attention");
    expect(customerHistoryTone("account", "credit sale")).toBe("attention");
    expect(customerHistoryTone("account", "payment")).toBe("income");
    expect(customerHistoryTone("return", "refund")).toBe("outflow");
    expect(customerHistoryTone("sale", "paid")).toBe("balance");
    expect(customerHistoryTone("account", "advance_refund")).toBe("outflow");
  });
});

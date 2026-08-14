# Inventory costing

All monetary values are integer NGN minor units. External receipts use weighted-average cost:

```text
new value = existing value + receipt quantity × receipt unit cost
new average = round(new value / new quantity)
```

Rounding uses JavaScript `Math.round` to the nearest minor unit. `totalValueMinor` remains the controlling value; average unit cost is its rounded presentation and issue basis.

Quantity/batch issues carry the source weighted-average unit cost. When the last unit leaves, quantity, value, and average become zero, preventing residual rounding value. Internal destination value uses the exact source movement value, so total organization value does not change. Serialized movements use the sum of item-level current costs and preserve each asset's acquisition/current cost.

Positive adjustments require an authorized non-negative unit cost or use the protected default product cost. Negative adjustments use current source cost. Direct adjustments are limited to system administrators and assigned branch or warehouse managers and are immediately posted; branch managers remain quantity-only and do not receive protected cost fields. Draft/value-threshold approval policy is deferred. Reversals negate original value deltas rather than recalculating current cost.

Default product costs are stored in `productCosts`, not broad product documents. Quantity-only roles receive sanitized callable responses. Firestore direct reads of balances, entries, serials, lots, and product costs are restricted to roles with cost access.

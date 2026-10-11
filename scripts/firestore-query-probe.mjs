const ops = { "==": "EQUAL", "!=": "NOT_EQUAL", ">=": "GREATER_THAN_OR_EQUAL", "<=": "LESS_THAN_OR_EQUAL", ">": "GREATER_THAN", "<": "LESS_THAN", in: "IN", "not-in": "NOT_IN", "array-contains": "ARRAY_CONTAINS" };

export function auditAggregations(sums) {
  return sums.length ? sums.map((fieldPath, index) => ({ alias: `sum${index}`, sum: { field: { fieldPath } } })) : [{ alias: "count", count: {} }];
}

export function auditFilter([field, op]) {
  if (!ops[op]) throw new Error(`Unsupported query operator: ${op}`);
  const upper = op === "<" || op === "<=";
  const value = (second = false) => {
    if (field === "active") return { booleanValue: true };
    if (field === "variance") return { integerValue: "0" };
    if (["createdAt", "effectiveAt", "recordedAt", "occurredAt", "collectedAt"].includes(field))
      return { timestampValue: upper ? "2026-10-02T00:00:00Z" : "2026-10-01T00:00:00Z" };
    if (["countDate", "transactionDate", "occurredOn"].includes(field)) return { stringValue: upper ? "2026-10-02" : "2026-10-01" };
    return { stringValue: second ? "index-audit-second" : "index-audit-probe" };
  };
  return { fieldFilter: { field: { fieldPath: field }, op: ops[op], value: ["in", "not-in"].includes(op)
    ? { arrayValue: { values: [value(), value(true)] } } : value() } };
}

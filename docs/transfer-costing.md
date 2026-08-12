# Transfer costing

Authoritative costs live in `transferCosts` using integer NGN minor units. The workflow is estimate → submit → approve/reject → actual incurred → reconcile. A creator cannot approve their own cost. Only authorized roles receive cost details.

Transfer totals maintain estimated, approved, actual, and variance. Item allocation defaults to inventory value with quantity fallback; `allocateMinorUnits` uses deterministic largest-remainder rounding. Allocation is report-only and does not rewrite acquisition cost.

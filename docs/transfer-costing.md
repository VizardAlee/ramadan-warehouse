# Transfer costing

Authoritative costs live in `transferCosts` using integer NGN minor units. The workflow is estimate → submit → approve/reject → actual incurred → reconcile. An authorized manager may approve their own cost within their assigned scope; creators without manager self-authorization need another authorized approver. Only authorized roles receive cost details. Incurred and reconciled cost states do not establish that a provider has been paid.

Transfer totals maintain estimated, approved, actual, and variance. Item allocation defaults to inventory value with quantity fallback; `allocateMinorUnits` uses deterministic largest-remainder rounding. Allocation is report-only and does not rewrite acquisition cost.

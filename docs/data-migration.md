# Data migration runbook

Sequence organization units and locations, categories/products/SKUs, opening quantity/lot/serial stock, then explicitly approved in-transit, request, and transfer cutover records. Freeze source changes, export and hash inputs, map identifiers, run preview, resolve every row error, obtain business sign-off, confirm through trusted callables, reconcile inventory, and disable opening stock.

CSV confirmation re-runs validation, is organization/user rate-limited, records source hash and idempotency, and posts stock through the existing immutable ledger. Never import directly from the browser to balances. Existing transit/transfers require a separately approved mapping and are not implemented by the basic importer.

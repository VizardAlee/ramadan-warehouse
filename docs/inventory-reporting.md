# Inventory reporting

Phase 2 exposes paginated callables for stock position, SKU movement, valuation, serial inventory, stock adjustments, and stock-count variances. Product detail uses separate paginated movement history and a stock-summary callable. The UI exports exactly the currently loaded, server-filtered rows to CSV with escaped headings and values.

Report permission is separate from inventory posting. Export controls require `reports.inventory.export`. Costs are included only when the caller also has `inventory.cost.read`; unauthorized cost properties are removed server-side. Default product cost resides in a separate protected collection.

Indexes in `firestore.indexes.json` cover organization/product and organization/location balance queries, stable product/location movement history, serialized assets, lots, adjustment entries, and stock-count variances. New compound filter combinations must be reviewed and indexed deliberately rather than falling back to browser scans.

Current report filters expose product and location in the UI; movement-history validation also supports effective date, transaction type, and serial. The broad requested category, brand, branch, warehouse, actor, lot, and reference filter matrix and maintained export jobs are deferred high-volume reporting work. Pages are capped at 100 server records and never scan entire collections in the browser.

# Product and SKU model

Products are organization-scoped and support quantity, batch, or serial tracking. They contain a normalized SKU, optional flat category, brand/model/description, validated unit, replenishment thresholds, currency, active state, authorship, and a ledger-activity guard.

SKU entry is optional when creating a product. When omitted or blank, the server generates `SKU-{PRODUCT_ID}`; a manually supplied SKU is retained instead. Omitting SKU during a later edit preserves the product's existing SKU. The server trims and uppercases SKU comparison values. `organizationSkus/{organization + normalizedSku}` provides transactional, case-insensitive uniqueness for both generated and manual values while allowing the same SKU in another organization. Category codes use the same lock pattern. Catalogue writes are callable-only and audited. Deactivation preserves history; hard deletion is never exposed.

The product editor accepts either an existing category name or a new one. Existing active categories are reused case-insensitively; a new name creates an active category in the same transaction as the product. Category codes are optional in the standalone editor and are generated from the category name when omitted. Transactional code locks prevent concurrent product saves from creating duplicate automatic categories.

Once `hasLedgerActivity` is true, tracking type cannot change without a separately designed migration. Inactive products remain in reports but cannot receive new postings.

Serial identifiers are normalized server-side and use deterministic organization-wide document IDs. A serial cannot be created twice, reassigned to another product, or moved from the wrong location. Status derives from the destination location. Written-off assets require an explicit future restoration workflow.

Lots are unique per organization and product after normalized comparison. A lot records receipt metadata, total received, remaining quantity, location quantities, unit cost, and last transaction. Expiry and manufacturing dates are optional.

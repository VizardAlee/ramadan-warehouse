# Retail and wholesale pricing

This extends `productSalesPrices`, the existing customer record and POS workflow.
It does not introduce a second catalogue, customer identity or sales ledger.

## Operation

- Price administrators (`sales.price.base.manage`) set retail and optional
  wholesale prices in Products. Clearing wholesale disables that level.
- Customer managers can choose a customer's default level. This grants no
  credit authority and does not change the customer's credit limit.
- Selecting a customer applies their level to the basket where configured.
  Products without wholesale use retail, with the level visible on each line.
  Staff receiving an order can choose either approved level on a basket line.
- Store-wide overrides apply to retail only. Wholesale uses its approved central
  price and central version, not an unrelated store override version.
- Sale-specific manual prices retain their existing required audit reason.
  Switching customer or level preserves these manual prices; review the total.

## Trusted validation and history

Order intake and posting resolve the selected price on the server. Wholesale
snapshots must match the central price, VAT and version. Unconfigured wholesale,
invalid money and stale snapshots fail rather than silently switching levels.
Price configuration, level selection and manual overrides are audited.

Each central price save retains a new immutable
`productSalesPrices/{productId}/versions/{version}` document with its effective
start and actor. The first update of a legacy configuration captures its prior
version before replacing the current projection. Existing clients that omit
wholesale preserve its configured value. Explicit null disables wholesale.
Ordinary clients cannot write these version documents. Historical sale items
retain their unit price, VAT, source and version; new items also record level.
No historical sale, ledger or customer balance is rewritten by this change.

## Held and offline sales

Held baskets retain their selected level. Resuming uses current catalogue and
stock, with stale manual overrides reset by the existing review logic. If the
wholesale configuration has disappeared, that held line is omitted and the
existing omitted-items warning requires review; it is not converted to retail.
Offline payloads retain level, price, VAT and version. Synchronization checks
the snapshot again. Changed prices remain queued for explicit review, never
silently repriced or posted twice. Credit authorization still requires online
access.

Prices saved now become effective immediately. Scheduled future price lists and
arbitrary administrator-defined levels are not implemented by this slice. The
level field and retained versions can be extended without changing historical
retail/wholesale documents.

Validation and deployment are recorded in the existing business workflow roadmap.

# Catalogue and CSV import formats

The Product catalogue provides a guided import for UTF-8 CSV and Excel `.xlsx`
files. The first row must contain unique headings. Familiar headings are matched
automatically, and the user can map every unmatched source column to a system
field before any data is sent to the server. The UI previews the first five
rows, then server validation reports the exact row and field for each error.

Product SKU is optional and is generated when blank. Unit of measure and tracking
type can come from mapped columns or one-time import defaults. Category accepts a name;
an active category is reused or created during the confirmed import. Costs and
prices are entered in naira with no more than two decimal places, while VAT is
a separate percentage. The supported product fields are:

- Product name (required)
- SKU
- Category
- Brand
- Model
- Description
- Unit of measure (mapped or supplied as an import default)
- Tracking type (mapped or supplied as an import default: `quantity`, `batch`, or `serial`)
- Default unit cost (₦)
- Central base selling price (₦)
- VAT rate (%)
- Minimum stock
- Reorder level
- Active
- Opening quantity (optional)
- Serial numbers (optional, pipe-separated; required when importing serialized stock)
- Batch / lot number (optional; required when importing batch-tracked stock)

To bring in stock with the catalogue, map an opening quantity, select the store
where those items are physically held, and supply a unit cost. Blank or zero
quantities create a product without stock. Positive quantities require the
`inventory.opening_stock` permission and are posted as immutable opening-balance
transactions; they do not directly overwrite on-hand balances. One import
uses one store location. Split files by store if the source includes stock at
several stores. Serial-tracked rows require exactly one serial per unit, and
batch-tracked rows require a lot number.

The downloadable template contains the preferred headings and an example row.
Legacy Excel `.xls` files must be saved as `.xlsx` or CSV before upload.

After column mapping, the protected import service receives canonical UTF-8 CSV.
It supports quoted fields and doubled quotes, a 1 MB/500-row server limit, and
requires exact canonical headers.

- Products: `name,unitOfMeasure,trackingType` with optional `sku`,
  `categoryName`, `categoryId`, `brand`, `model`, `description`,
  `defaultUnitCostNaira`, `defaultUnitCostMinor`,
  `baseSellingPriceNaira`, `vatPercent`, `minimumStockLevel`, `reorderLevel`,
  `active`, `openingQuantity`, `openingLocationId`, `openingSerialNumbers`,
  and `openingLotNumber`.
- Opening stock: `productId,locationId,quantity,unitCostMinor` with optional `serialNumbers` (pipe-separated) or `lotNumber`.
- Serial numbers: `productId,locationId,serialNumber,unitCostMinor`.

Opening-stock and serial-import money remains integer minor units. Product
catalogue mapping uses naira fields and converts them to integer kobo on the
server. SKUs/serials are compared case-normalized. Preview reports 1-based row,
field, stable code, and safe message. A failed confirmation preserves the
import operation summary; retrying the same failed import with the same file
and idempotency key resumes its rows without reposting completed opening
balances. Repeating a completed key never posts again.

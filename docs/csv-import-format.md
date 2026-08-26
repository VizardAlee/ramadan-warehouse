# Catalogue and CSV import formats

The Product catalogue provides a guided import for UTF-8 CSV and Excel `.xlsx`
files. The first row must contain unique headings. Familiar headings are matched
automatically, and the user can map every unmatched source column to a system
field before any data is sent to the server. The UI previews the first five
rows, then server validation reports the exact row and field for each error.

Product SKU is optional and is generated when blank. Category accepts a name;
an active category is reused or created during the confirmed import. Costs and
prices are entered in naira with no more than two decimal places, while VAT is
a separate percentage. The supported product fields are:

- Product name (required)
- SKU
- Category
- Brand
- Model
- Description
- Unit of measure (required)
- Tracking type (required: `quantity`, `batch`, or `serial`)
- Default unit cost (₦)
- Central base selling price (₦)
- VAT rate (%)
- Minimum stock
- Reorder level
- Active

The downloadable template contains the preferred headings and an example row.
Legacy Excel `.xls` files must be saved as `.xlsx` or CSV before upload.

After column mapping, the protected import service receives canonical UTF-8 CSV.
It supports quoted fields and doubled quotes, a 1 MB/500-row server limit, and
requires exact canonical headers.

- Products: `name,unitOfMeasure,trackingType` with optional `sku`,
  `categoryName`, `categoryId`, `brand`, `model`, `description`,
  `defaultUnitCostNaira`, `defaultUnitCostMinor`,
  `baseSellingPriceNaira`, `vatPercent`, `minimumStockLevel`, `reorderLevel`,
  and `active`.
- Opening stock: `productId,locationId,quantity,unitCostMinor` with optional `serialNumbers` (pipe-separated) or `lotNumber`.
- Serial numbers: `productId,locationId,serialNumber,unitCostMinor`.

Opening-stock and serial-import money remains integer minor units. Product
catalogue mapping uses naira fields and converts them to integer kobo on the
server. SKUs/serials are compared case-normalized. Preview reports 1-based row,
field, stable code, and safe message. A failed confirmation preserves the
import operation summary; repeating a completed idempotency key never posts
again.

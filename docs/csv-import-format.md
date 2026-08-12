# CSV import formats

UTF-8 CSV supports quoted fields and doubled quotes, a 1 MB/500-row limit, and exact headers.

- Products: `sku,name,unitOfMeasure,trackingType,defaultUnitCostMinor` with optional `categoryId`.
- Opening stock: `productId,locationId,quantity,unitCostMinor` with optional `serialNumbers` (pipe-separated) or `lotNumber`.
- Serial numbers: `productId,locationId,serialNumber,unitCostMinor`.

Money is integer minor units. SKUs/serials are compared case-normalized. Preview reports 1-based row, field, stable code, and safe message. A failed confirmation preserves the import operation summary; repeating a completed idempotency key never posts again.

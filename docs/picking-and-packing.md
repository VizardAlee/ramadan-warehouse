# Picking and packing

Picking records reserved quantity, exact serials/lots, variances, notes, picker identity, and timestamps. It is preparation, not a ledger movement, and cannot exceed reservation. The checker must be a different assigned warehouse user.

Packages preserve package number, dimensions, seal/barcode/QR-ready identity, contents, and serials. Only picked quantities may be packed. Sealing transactionally updates packed totals. A checked sealed package is required for dispatch, and dispatched contents are immutable. Binary photos remain deferred; metadata references are supported.

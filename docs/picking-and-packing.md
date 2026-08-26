# Picking and packing

Picking records reserved quantity, exact serials/lots, variances, notes, operator identity, and timestamps. It is preparation, not a ledger movement, and cannot exceed reservation. For a normal transfer, the same authorized warehouse operator may pick, pack, seal, and dispatch. A second origin-warehouse checker is optional and may still verify the pick or sealed package when local policy or risk warrants it.

Packages preserve package number, dimensions, seal/barcode/QR-ready identity, contents, and serials. Only picked quantities may be packed. Sealing transactionally updates packed totals. A sealed package is required for dispatch, and dispatched contents are immutable. Independent checking remains available for serialized, damaged, lost, written-off, unusually valuable, or otherwise exceptional movements. Binary photos remain deferred; metadata references are supported.

The normal guided path is deliberately short: record picked goods, pack and seal, enter delivery details, and confirm dispatch. The destination branch confirms receipt. This origin/destination separation is the primary control for ordinary replenishment.

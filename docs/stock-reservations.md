# Stock reservations

Reservations atomically read source balances, trusted transfer items, exact serial records, and existing projections. They increment `reservedQuantity` and recompute `availableQuantity = onHandQuantity - reservedQuantity`; they never change on-hand/value or create inventory transactions.

Batch reservations identify exact lots. Serial reservations lock exact items with transfer/reservation IDs. Firestore retries prevent concurrent over-allocation. Release restores availability without changing on-hand, and only unconsumed quantity can be released. Dispatch consumes reservation inside central posting. Expiry is notification/review-only by default.

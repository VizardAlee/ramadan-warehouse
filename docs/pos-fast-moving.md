# POS fast-moving products

The POS catalogue offers **All products** and **Fast-moving** filters. Qualified
cards carry the label in either view and use the existing Add button. Search,
stock checks, queued-stock deductions, pricing, permissions and customer
selection continue through the ordinary POS flow. Out-of-stock goods retain the
label but their Add button stays unavailable. Services are not ranked.

## Rule

Use completed `sales` at the active branch whose `recordedAt` falls within the
last 30 × 24 hours. Only active quantity/serial goods are eligible. Count distinct
receipts per product, once per receipt regardless of line count or quantity.
Subtract each line's approved `saleReturnItemCounters.returnedQuantity` and
`saleItems.cancelledQuantity` first; a receipt contributes only while positive
quantity remains. Non-restockable returns count as returns too. Return requests
and rejected returns never change the approved counters. Stock transfers,
staged/rejected sales orders, services and parts included in services are absent
from this purchase-frequency population. Completed delayed-pickup sales count
as purchases; approved cancellation of their uncollected goods removes them.

Require at least ten qualifying goods receipts across three Lagos calendar days
for the branch. A product needs five distinct receipts across three Lagos days.
It must also reach the top 20% by receipt frequency among active, unit-verifiable
goods with positive purchases. Round the population cutoff upward; include all
ties at that cutoff. No arbitrary winner is chosen for a tie. With one eligible
product, it can qualify only after meeting the same repeat-activity requirements.
Limited history may legitimately yield no suggestions; a ready result can also
contain no qualifying products.

The current schema stores quantities in each product's `unitOfMeasure`; it has
no variant-parent rollup or pack conversion model. SKUs/product IDs remain
separate. Rank receipt frequency rather than adding quantities across unlike
units. If any historical line's unit differs from the current product unit, or
its unit is missing, that product receives no label. No conversion factor is
invented and no financial or inventory policy is changed.

## Refresh, privacy and limits

`getPosWorkspace({ branchId, fastMoving: true })` uses the existing App Check,
sign-in, permission, organization, active-branch, sales-location and branch-scope
guards. Its response contains only version, branch, status, product IDs and
freshness timestamps. It contains no receipt counts, quantities, sales values,
customer information, costs or margins. This is not access to the reporting API.
No IAM, credentials, security rules or role definitions are changed.

The browser loads suggestions separately after the ordinary catalogue, so a cold
calculation does not block stock/prices or checkout. Server-only
`posFastMovingSummaries` cache documents expire after 15 minutes. A transactional
90-second lease prevents concurrent cold calculations for a branch; competing
requests show a refreshing state. Clients recheck at expiry while online and
suppress labels offline or across branch/user scope changes. New sales/returns
can take up to 15 minutes to affect labels.

A refresh uses a branch/date query capped at 1,001 receipts, line queries in
batches of 30 sale IDs (each capped at 1,501), at most 5,000 lines, batched approved
counter/product reads, and a 20-second processing deadline within the existing 30-second callable timeout. More than 1,000
receipts, more than 5,000 lines, missing lines, invalid quantities or inconsistent
counter scopes produce **unavailable**, never a partial ranking. Failures are
cached for one minute. High-volume branches beyond these explicit limits need a
separately designed maintained daily projection; the UI does not pretend their
bounded sample is complete. Existing live indexes cover the new query shapes.

## Verification

Pure calculation tests cover thresholds, ties, receipt deduplication, rolling
window, branch/tenant isolation, completed versus staged/cancelled orders,
approved partial/full returns, delayed-pickup cancellations, unit mismatches,
separate product IDs and corrupt/missing evidence. Client tests cover filters,
normal cart selection, out-of-stock Add checks, status help, stale responses and
offline suppression. Real SDK tests use only local demo emulators and test
cashier/anonymous/role/branch boundaries, private summary access, cache reuse,
return refresh, refresh leases and incomplete evidence. Production verification
must distinguish public release/artifact checks from signed-in acceptance.

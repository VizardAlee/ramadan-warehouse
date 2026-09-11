# Simple stock transfers

Deployment checkpoint: 2026-09-06. Commit `9a3c464` is deployed to the existing production environment.

## Everyday workflow

1. **Request stock.** A source or destination manager selects the sending warehouse or branch, the receiving branch, products and quantities. A note is optional. An existing approved branch request can be linked.
2. **Source manager approves.** A manager assigned to the sending location reviews the quantity and selects actual serial identities where applicable. A system administrator may do this for any location. Approval atomically holds stock, and the requester may approve their own in-scope request; no extra approver, picker, packer or driver account is required.
3. **Receiving manager confirms arrival.** The destination manager counts actual goods and confirms all or a partial receipt. An administrator may act on behalf of the destination, with their own identity recorded. Good goods enter saleable destination stock; full good receipt completes the transfer automatically.

There is no mandatory packaging, sealing, transport-cost, picking, dispatch or manual-close form. Warehouse-to-branch and branch-to-branch use the same flow within the same organization. Transfers are inventory movements, not sales or supplier purchases; they do not create customer revenue, VAT, cash or a supplier payable.

## Meaning of stock while awaiting receipt

Approval is **not** evidence that goods departed. While awaiting acknowledgement, the quantity remains in the source ledger but is held and unavailable for sale or another transfer. The UI must call this “Awaiting receipt”, not “Dispatched” or “In transit”. The simplified workflow does not establish an independently verified departure time or physical in-transit balance.

At acknowledgement, a single Firestore transaction releases the relevant hold, posts paired source/destination ledger entries, updates balances and serial/lot ownership, records receipt evidence, and updates linked request fulfilment. No synthetic picking, packing, dispatch or legacy logistics record is created.

## Exceptions without another compulsory workflow

- Partial delivery: enter only good and damaged quantities that physically arrived. The remainder stays held for a later receipt.
- Damaged goods: enter them separately; they enter a system-managed damaged area, never the saleable stock location. The administrator reviews the problem.
- Nothing arrived: report a problem; do not manufacture a receipt.
- Remainder still expected: administrator records the decision; the hold remains.
- Remainder never left: administrator explicitly confirms it remains at source, then cancels/releases only that remainder.
- Confirmed lost: administrator explicitly records the loss; source stock/value is removed to the inventory-loss ledger account, not released for sale.
- Receipt correction: immutable receipt evidence cannot be directly reversed through the generic inventory reversal endpoint. Use a controlled return/adjustment; do not rewrite acknowledgement history. Branch-to-warehouse return UI is not part of this simplified receiving workflow.

Cancelling transfer remainder does not cancel approved branch-request demand. For request approval 20, receipt 12 and cancellation 8, the transfer completes while the request remains fulfilled 12/outstanding 8; a later transfer can allocate the eight.

## Permissions and safety

- System administrators require no location assignment to manage any location in their organization. Normal managers are restricted to their assigned source/destination, including the selected operating context.
- Source-location managers and administrators approve and resolve remainders; only destination managers or administrators acknowledge goods.
- Branch managers can discover source names, product names and available quantities needed to request stock; this does not grant access to unrelated transfers, costs or customer data.
- Firebase Auth, authorization-version checks and App Check remain enforced. New collections are callable-only under the default-deny Firestore rules.
- Every write is atomic, version-checked and idempotent. A retry key is bound to actor, action and payload. Concurrent approvals/receipts/sales serialize against shared inventory balances.
- Serial identity is mandatory for serial-tracked goods; lot identity is mandatory for batch stock. Transfers are limited to 20 distinct product/lot rows and at most 100 reserved serialized units.
- Transfer posting requires connectivity. Offline POS behavior is unchanged; reconnecting POS still checks current stock and can require conflict resolution if stock was committed elsewhere.
- Notification events are recorded using the existing adapter. This release does not add email, SMS or push delivery; users find work through the in-app queue.

## Compatibility and records

New transfers use `stockTransfers`, `stockTransferEvents` and `stockTransferReceipts`, plus the existing inventory/audit collections. No data migration or rewrite of legacy transfers is performed. `/transfers` is the normal workflow; `/transfers/legacy` retains earlier records, the original queues and optional detailed creation. Legacy staff retain their existing detailed-workflow access.

Dashboard counts and operational request reconciliation include both workflows. `reconcileTransfer` recognizes either ID and compares the appropriate evidence. Authorized users can download the currently filtered simple-transfer view as CSV, with spreadsheet-formula escaping. Existing logistics-specific report endpoints remain legacy reports; they must not be described as covering the simplified register or invented dispatch events.

## Verification

`npm run test:stock-transfers` uses only the guarded `demo-ramadan-warehouse` Auth/Firestore/Functions emulators. Cases cover the three-task journey, assigned source-manager self-approval, scope denial, replay and concurrent posting, partial receipts, quarantine, cancellation preserving demand, direct branch supply, loss, serial/lot conservation, and reconciliation/reversal guards. Existing transfer tests remain separate regression coverage.

The live release required the new callable, affected reconciliation/reversal callables, and web build. No synthetic production users or stock were created for verification.

### Local verification evidence — 2026-09-06

The 11 new callable cases passed. The affected inventory suite (13 tests) and request suite (8 tests) passed on focused reruns. The wider emulator run also passed legacy transfer, sales, serialized/lot transfer, cancellation, concurrency and Firestore-rules checks. Initial broad runs hit test-duration limits while local build/preview processes competed for resources; reruns used a 90-second CLI allowance without changing assertions or runtime settings, and every individual case completed within 30 seconds.

A browser smoke test using an emulator-only administrator created a Central Warehouse → Kaduna Branch transfer for two panels, approved it and confirmed arrival. The UI showed Completed, received 2 and still expected 0. No picking, packing or dispatch record was required. This was demo data only, not a live business transaction. Narrow/mobile and tablet-width screens were inspected; physical Safari/iOS device validation is not claimed.

Lint, both TypeScript checks, all 139 unit tests across 33 files, the Functions build, the repository secret scan, whitespace checks and production configuration safeguards passed. The production webpack build passed; the local Turbopack build could not start its required process/port in this environment.

### Production deployment evidence — 2026-09-06

`stockTransfers`, `reconcileTransfer`, `reconcileWarehouseOperations`, and `reverseInventoryTransaction` are ACTIVE Gen 2 Functions with `APP_ENV=production` and callable App Check enabled. The owner approved disabling the Cloud Run invoker IAM check for `stockTransfers` only because organization policy blocked the callable transport configuration; Firebase Auth, App Check, authorization-version, organization and location enforcement remain active. An unauthenticated HTTPS request was rejected with HTTP 401 `UNAUTHENTICATED`.

App Hosting completed the rollout at the existing production URL. The login and protected transfer routes returned HTTP 200, and the deployed login HTML contained the expected AB Ramadan identity. No Firestore/Storage rules, indexes, scheduled services, monitoring policy, production data or legacy transfer records were changed. The full simplified journey was browser-tested against isolated demo emulators; no live stock movement was created, so authenticated production business-flow validation remains an owner smoke-test activity.

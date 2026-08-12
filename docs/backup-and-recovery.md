# Backup and recovery

Target RPO is 24 hours and target RTO is 8 hours until business owners approve tighter objectives. Configure scheduled Firestore exports to a versioned, encrypted, access-logged bucket in a compatible region; apply retention/hold policy and separate backup-operator IAM. Define Storage backup only when uploads are enabled. Auth user export requires protected credentials and separate handling; Secret Manager values are reconstructed from the approved secret register, never source control.

Quarterly restore tests use an isolated target: preferably a temporary secondary Firestore database in the staging project, or an approved disposable project when cross-service recovery is required. Never restore over `(default)`. Restore data, validate representative collections and counts, and preserve audit records and recorded evidence. Auth, Secret Manager, deployed rules/indexes, Functions, and other project-level resources remain separate recovery concerns.

As of 2026-08-12, the immutable project now used for production has a daily managed Firestore backup schedule with seven-day retention and verified pre- and post-bootstrap backups.

## Restore drill evidence — 2026-08-12

- Source: READY managed backup `25d3d91a-b856-4a6a-b34d-0804e0bc3013` from `(default)` in `nam5`, snapshot `2026-08-11T17:24:55.699584Z`; expiry `2026-08-18T17:24:55.699584Z`.
- Target: temporary secondary database `restore-test` in the same staging project. Firestore restore created it in `nam5`; `(default)` was never targeted or changed.
- Operation: started `2026-08-12T13:50:07.059587Z`, reached `SUCCESSFUL`/100% at `2026-08-12T14:01:28.622141Z` (about 11 minutes 22 seconds).
- Verification: read-only `listCollectionIds` and collection reads succeeded after completion, but the restored database contained zero collections. The selected backup predates bootstrap, matching the documented initial/pre-bootstrap snapshot. Current `(default)` contained 1 organization, 3 branches, 1 warehouse, 15 locations, 6 products, 33 inventory transactions, 78 entries, 19 balances, 8 serials, 1 lot, 8 requests, 12 transfers, and 258 audit records; none existed in the source snapshot.
- Classification: the managed-backup restore mechanism is proven, but representative business-data recovery validation is **Blocked** because no post-bootstrap managed backup exists yet. Repeat after the next daily backup is READY.
- Cleanup: `restore-test` was deleted at `2026-08-12T14:04:01.499989Z`. A final database list contained only `(default)`. The source backup remains READY and was not deleted.

## Post-bootstrap restore retry — 2026-08-12

- Backup eligibility check: the managed-backup list still contained only READY backup `25d3d91a-b856-4a6a-b34d-0804e0bc3013`, snapshot `2026-08-11T17:24:55.699584Z`. Because it predates bootstrap and live acceptance, it was not reused.
- Schedule: daily schedule `5037b5a9-687a-4951-bd1b-e2e4854bccc2` remains active with seven-day retention. Based on the prior snapshot, the next backup is expected around the next 17:24 UTC daily window, subject to the managed service's scheduling.
- Baseline: a read-only capture at `2026-08-12T14:20:29.373Z` confirmed `(default)` contains 1 organization, 3 branches, 1 warehouse, 15 locations, 6 products, 33 inventory transactions, 78 ledger entries, 19 balances, 8 serials, 1 lot, 8 branch requests, 12 transfers, and 258 audit records. Representative evidence includes organization `RWSTG`; branches `KAN`, `KAD`, and `ABJ`; warehouse `CWH`; location `CWH-AVL`; SKU `STG-BREAKER-63` with a `CWH-AVL` balance of 22 on hand/0 reserved/22 available; serial `STG-BAT-0001` in immutable `written_off` status; lot `STG-CABLE-LOT-001`; request `REQ-KAD-2026-000007` in `fulfilled`; transfer `TRF-CWH-KAN-2026-000002` in `closed`; and audit action `inventory.discrepancy_resolution`. These values are the future snapshot-comparison reference, allowing for events after the selected backup time.
- Action: no restore was started and no temporary database was created because no eligible post-bootstrap READY backup exists. `(default)` and the source backup were untouched; the database list contains only `(default)`.
- Classification: representative business-data restore capability remains **Blocked** until the next post-bootstrap managed backup reaches READY. Mechanical restore and safe cleanup remain previously proven.

This representative-data recovery was the mandatory gate for the owner-approved conversion of immutable project ID `ramadan-warehouse-staging` into the operational production environment. The qualifying snapshot passed isolated restore verification and cleanup before alias/runtime conversion, synthetic-data cleanup, Auth-user removal, or bootstrap reset began.

## Representative conversion restore — passed

- READY backup `36b62798-14dd-4991-b7a0-fe7ceea06a03`, snapshot `2026-08-12T17:38:09.517272Z`, restored from `(default)` into isolated `restore-test` in `nam5`.
- Operation `_eV9KCL9fLUVRdMZzjEkpxAqNW1hbgQiChAaGg` started `2026-08-12T18:20:30.288280Z` and completed successfully at 100%.
- All 51 expected collections and representative organization, master, inventory, ledger, balance, serial, lot, request, transfer, approval/version/event, and audit evidence were recovered. Counts matched the snapshot and integrity checks found no material anomaly.
- `restore-test` was deleted at `2026-08-12T20:03:31.760981Z`. `(default)` was untouched and the source backup remains READY.
- Final classification: **Passed**. The backup is retained as the historical synthetic-environment recovery point after production reset.

# Emulator seeding

Phase 4 seed data adds an approved request-linked Kaduna transfer, direct Kano replenishment, reconciled breaker stock in transit, a damaged/missing transfer, route transit/damaged locations, packages, dispatch logistics, and reconciled costs. Seed movements have balanced entries and matching source/transit/damaged projections.

Run:

```bash
npm run seed:emulator
```

The command starts Auth and Firestore emulators for `demo-ramadan-warehouse`, then runs a server-side seed script. The script refuses to run unless both emulator host variables exist and the project ID starts with `demo-`. It never uses browser code or production credentials.

The seed is idempotent and creates a development organization, system administrator, Kaduna and Kano branches, a Kaduna branch requester, central warehouse, two physical warehouse locations, owned damaged/quarantine/returns locations, and one branch location. It also creates six representative solar products, protected product costs, SKU/category uniqueness locks, balanced opening-ledger entries, balance projections, one lot, serialized inverter/battery assets, and draft, urgent-submitted, partially-approved, and changes-requested branch requests with version/event history. Deterministic IDs make reruns replace the same emulator fixtures rather than duplicate records.

The seed uses Admin SDK writes because the Functions emulator is not part of this command. It mirrors the posting invariants (paired zero-sum entries, integer costs, matching balances, serial and lot projections) and is guarded by emulator host variables plus a `demo-*` project ID. Callable integration tests exercise the real trusted posting service.

Emulator login:

```text
admin@warehouse.local
EmulatorOnly!234567
```

Branch requester login:

```text
requester.kaduna@warehouse.local
EmulatorOnly!234567
```

This credential is deliberately emulator-only. Reset local data by stopping the emulators and restarting without an import, or use the Emulator UI's clear-data controls, then rerun the seed.

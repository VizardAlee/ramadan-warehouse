# Warehouse application implementation plan

## Phase 1 — Foundation (this change)

1. Establish strict TypeScript Next.js and Cloud Functions projects.
2. Configure Firebase clients, Admin SDK, Emulator Suite, and environment validation.
3. Define user, organization, branch, warehouse, location, role, permission, and audit models with Zod validation.
4. Add authenticated app shell, role-aware navigation, login and foundation administration views.
5. Add server-side identity/authorization helpers, append-only audit writing, baseline callable context endpoint, and an integration contract.
6. Add deny-by-default Firestore and Storage rules plus unit and emulator rule tests.
7. Validate lint, type checking, tests, production build, and Firestore emulator tests.

## Later phases

- Phase 2: product catalogue, serialization, immutable movement ledger, balances, and SKU history.
- Phase 3: branch requests and request approvals.
- Phase 4: transfers, server-validated state machine, reservation concurrency, and release.
- Phase 5: picking, maker-checker packing, dispatch, and goods in transit.
- Phase 6: receipts, discrepancies, reversals, and closure controls.
- Phase 7: integer-minor-unit costs, finance approvals, reconciliation, and locking.
- Phase 8: maintained reporting summaries, exports, versioned integration adapters, monitoring, and operational hardening.

Each phase should add emulator tests for its invariants before the next phase begins. Production deployment remains a separate, explicitly approved activity.

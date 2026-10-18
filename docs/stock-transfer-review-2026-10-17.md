# Stock-transfer correctness and security handoff — 2026-10-18

Base: deployed main `066c0e95efadd2f4cdc1dea25debc8e926fff165`.
Candidate: `/home/aliyu/Documents/Codex/2026-10-17/task-6/stock-transfer-review`.

This is a local, prospective correctness candidate. No live transfer, historical repair, push, PR or deployment was performed. The financial worker's checkout was not modified. The original two-fix patch is preserved as `../stock-transfer-workflow-original.patch` (SHA-256 `2278b0d5d015d809e8adbf2aadb7c7dbc2ee87fc1e733d882c831adeafa6e601`). The pre-security correctness patch is also preserved as `../stock-transfer-workflow-correctness.patch`. The updated unified patch is `../stock-transfer-workflow.patch`; the approved security delta is `../stock-transfer-security.patch`.

## Current review revision

Independent review of patch SHA `126f7746f072a03c100e802f0c6b4581f1b69b6512b7587ff69f48321a8f39c1` found draft-routing substitution, committed-command/cache interruption and zero-delta cancellation blockers. All three are fixed within the existing approved scope. The source passed 177 focused tests and zero-warning lint, then Astra cleared production SHA-3b131c22 with no remaining P0/P1/P2 findings. The subsequent exclusive validation run passed full semantic checks/builds, 30 real-emulator tests and repeated desktop browser QA. Production files remain byte-identical to the cleared source; only test/evidence additions follow that review. See [Current reviewer-fix evidence](stock-transfer-validation-2026-10-18.md). Use `../stock-transfer-review-fixes.patch` against the preserved exact `../stock-transfer-workflow-pre-review.patch`, or the revised unified patch against deployed base.

## Changes included

- **Complete dispatch contents:** every selected package is read in queries of at most 30 IDs. The prior 31/100-package truncation is fixed. Duplicate package IDs, duplicate serials, mismatched package totals and inconsistent ownership are rejected before stock posting.
- **Recoverable dispatch and receipt execution (finding 3):** a prospective entity-owned execution plan freezes movements and original confirmation details. Stable movement references depend on the entity/plan, not a newly generated client key. Each progress marker commits in the same Firestore transaction as its stock movement through the existing inventory posting extension. Competing confirmations of the same entity share that plan; competing entities on the same transfer are blocked until it finishes.
- **Atomic cancellation and version validation (finding 4):** reservation release, request allocation release, cancellation state and audit evidence commit together after the current version/status is checked. A stale version or failed transaction releases nothing. A repeated partial cancellation releases only newly cancelled demand.
- **Dispatch-specific receipts (finding 5):** immutable dispatch-item manifests record exact quantities, serials and lots. Receipt planning checks the selected dispatch's package/manifest evidence, prior disposition claims, serial/lot identities and aggregate item disposition. Receipt claims, item/header finalization, good-stock request fulfilment and execution completion commit together after all planned movements exist. Changed instructions cannot resume an unfinished plan.
- **Exact lot remainder (finding 6):** further reservation rounds accumulate both cumulative and remaining lot allocations. Dispatch subtracts the actual lots consumed; release uses the exact remaining map. Safe unconsumed legacy reservations can retain their original exact allocation; partially consumed/released legacy allocations without exact remaining-lot evidence require review. A proven zero remainder needs no guessed allocation. Reservation availability is calculated from on-hand minus held stock rather than a possibly stale available projection.
- **Transfer-owned request demand (finding 7):** new request-linked transfer items record their owned allocation. Draft reductions release only their delta; pre-approval cancellation releases the transfer's owned allocation; good receipts reduce owned allocation and fulfil demand atomically with receipt finalization. Late-delivery discrepancy fulfilment now updates that ownership alongside its metadata. Missing legacy ownership requires review rather than inferring ownership from a shared aggregate.
- **Guided recovery:** after an uncertain action, the screen refreshes and shows a resume button for the saved dispatch/receipt. Resuming calls confirmation for the original document and saved quantities; it does not create another document. Guided “Receive all” now derives quantities/identities from one dispatch's manifest and claims, including partly dispatched transfers. Missing exact evidence disables the shortcut with review guidance.

## Invariants and precise atomicity boundary

1. New stock posting never starts until a plan is committed. Its transfer lock identifies the original document to resume.
2. A movement and its progress marker either both commit or neither commits. Progress cannot claim a movement that rolled back.
3. A retry skips committed progress and uses the same saved posting instructions for uncommitted movements. Finalization requires all progress markers, the same transfer version/stock state and the execution lock.
4. Cancellation, reservation release and competing transfer mutations cannot pass an active stock-execution lock. Discrepancy resolution claims also check that lock transactionally; a started/unfinished discrepancy resolution blocks new stock executions.
5. Final dispatch/receipt metadata and execution completion are atomic. Final receipt claims and linked request fulfilment cannot be stranded in their own earlier transaction.
6. Lot release and request demand release use explicit transfer ownership. They do not subtract a guessed quantity from somebody else's reservation/allocation.

**The complete multi-line dispatch/receipt is recoverable, not one atomic inventory transaction.** During an interrupted plan, committed stock may already be in transit/at destination while final header, item and reservation projections are still pending. The plan retains exact committed progress, the document remains unconfirmed and the UI offers resume. Reconciliation may report the unfinished projection; this candidate does not relabel it clean or invent completion.

Prospective bounds are enforced before a plan/stock movement is committed: plan JSON at most 700,000 bytes and an estimated finalization budget at most 450 writes. Oversized commands ask the user to split the document. Serialized movements are chunked into at most 50 identities per stock transaction; this preserves larger accepted dispatches through recoverable chunks rather than attempting an oversized inventory commit. These are execution/resource bounds, not permission changes.

## Conservative legacy handling and remaining limitations

- Existing inventory postings without an execution plan are review-only; this patch does not replay or repair historical half-finished commands.
- Existing request-linked transfers without explicit owned allocation, and partially consumed lot reservations without an exact remaining map, require evidence review. No automatic migration/backfill is included.
- Prior legacy receipt claims without versioned serial/lot disposition evidence require review. Package contents must still match any frozen dispatch manifest.
- Detailed discrepancy inventory resolution still uses its older multi-step posting process and client-key behavior. It was not converted into the new dispatch/receipt execution planner. Its request fulfilment now finalizes with metadata, and concurrency guards prevent it from overlapping a new stock execution. A subsequent receipt after a transit-affecting discrepancy disposition without updated dispatch-specific ownership is blocked for review instead of guessing outstanding units. Broader discrepancy recovery needs a separate coordinated design/test pass.
- A permanently invalid source balance or externally changed transfer stock state can leave a plan requiring manager review. There is no automatic timeout unlock or rollback of already moved goods; blindly unlocking could release stock that departed.
- The guided resume path covers an existing stock execution. An uncertain draft-document creation before planning can still leave an unused draft; no historical orphan cleanup is included.
- Existing `getTransfer` related-record reads remain capped at 200 per collection. A shortcut with missing evidence refuses to guess. Large-history pagination remains outside this patch.

## Store/warehouse clarification — policy unchanged

Stores may physically provide storage, distribution and outlet functions; this does not merge their stored entity types. Commit `bf4ce8cf73ff2bd0c8c29e6423277513f7203d0e` deliberately made stores the selectable locations in the simple transfer picker. That policy remains unchanged.

The existing simplified server validation accepts `warehouse` or `branch` as a source, but destinations must be `branch`; its options route exposes only active branch/store locations. Therefore an actual existing warehouse entity is excluded by discovery, not by source validation. Legacy detailed creation explicitly uses an origin warehouse and destination branch. Exposing existing warehouse entities in the simple picker requires a separate discovery-policy decision; supporting warehouse destinations requires a separate workflow-policy decision and review of receipt authority/location behavior. No entity merge, assignment broadening, warehouse-picker restoration or destination-type expansion is included. Inventory filtering/terminology remains with the main worker.

## Security findings 1–2 approved and implemented

Specific user approval was relayed on 2026-10-18 to restrict transfer actions to authorized locations and tighten retry validation. The exact behavior, compatibility policy, entrypoint coverage and verification are documented in [Approved transfer security changes](stock-transfer-security-2026-10-18.md).

All exposed legacy mutations now pass a transfer-specific callable boundary before their older handlers or replay branches. Current action permission, transfer reading authority, action-specific source/destination authority, working context and child/result ownership are checked before a result is returned. Global reading or an unrelated broad role base does not promote scoped mutations. Existing exact organization action grants retain their provenance; no permission catalog, role grant, App Check setting or shared authorization helper was changed.

New retry bindings cover actor, canonical action, entity and normalized parsed business payload. Authorized exact completed replays return a cached result without another mutation. Pending commands retain their identity through failures. Mismatched keys are denied; historical operation/resolution evidence without a trustworthy binding requires review rather than migration. Packing verification and discrepancy assignment gained atomic operation records so identical concurrent commands cannot repeat their metadata updates.

The active simplified flow retains its existing actor/action/payload retry binding and now independently enforces selected working location for scoped mutations, including when a broad read-only role bypasses the shared context narrowing. Store-only discovery, source/destination entity types and existing direct-manager capabilities remain unchanged.

## Files and shared ownership

Production edits are confined to `functions/src/callable/transfers.ts`, `functions/src/callable/stock-transfers.ts`, `functions/src/transfers/*`, `functions/src/validation/transfers.ts` and `src/features/transfers/*`. The existing inventory posting extension is consumed as an API.

The following shared files were **not** edited: `functions/src/inventory/post-inventory-transaction.ts`, `functions/src/auth/authorize.ts`, `functions/src/requests/apply-transfer-fulfilment.ts`, `src/types/domain.ts`, financial services, security rules and indexes. No shared-helper changes are required for this candidate; integration must still check compatibility with the financial worker's inventory extension changes.

New prospective records/fields include `transferStockExecutions`, dispatch manifests in `transferDispatchItems`, versioned per-dispatch receipt claims, remaining-lot maps, item-owned request allocation and transfer execution/resume fields. Server/admin writes use the existing callable boundary; no client collection write access was added. Resume metadata excludes the original client idempotency key and internal posting references.

## Validation follow-up

For the preceding SHA-126f7746 candidate, after the parent released the heavy slot, semantic checks, builds, real-engine emulator regressions and synthetic browser QA were completed. The reviewer fixes were subsequently independently cleared and revalidated through the final heavy gates documented above. A repeated partial receipt exposed an integration-outbox collision: event occurrence identity now prefers the receipt ID over its shared dispatch ID. See [Validation evidence and remaining boundaries](stock-transfer-validation-2026-10-18.md). The original source-only patch is preserved as `../stock-transfer-workflow-pre-validation.patch`; `../stock-transfer-validation.patch` applies these follow-up changes to it.

## Verification

**177 tests passed across 11 focused files**, including the existing simple-flow permissions, model, guidance, reconciliation, state-machine, closure and quantity-invariant tests.

New fixtures execute actual callable orchestration against in-memory Firestore with staged writes, rollback, discarded transaction retries and commit-failure injection. Legacy inventory posting is mocked to implement the documented atomic extension contract; this does not verify the real inventory engine or Firestore contention. The active simplified handler's quantity/value evidence is checked directly.

Covered cases include 1/30/31/100 packages; duplicate identities; failures before and after stock commit; finalization failure after receipt stock moved; fresh-key retries and competing confirmations; cancellation-versus-dispatch races; request/stock rollback together; stale version denial; lot-specific release; multiple reservation rounds; stale available projections; 120 serialized units split into recoverable chunks; dispatch-specific quantity/serial/lot rejection; ambiguous-history review; request draft reduction/pre-approval cancellation; and guided UI resume/dispatch-specific receipt behavior.

```sh
./node_modules/.bin/vitest run tests/transfer-legacy-workflow-fixtures.test.ts tests/transfer-stock-actions-ui.test.tsx tests/stock-transfer-workflow-fixtures.test.ts tests/simple-transfer-model.test.ts tests/simple-transfer-permissions.test.ts tests/transfer-state-machine.test.ts tests/transfer-calculations.test.ts tests/transfer-closure-matrix.test.ts tests/transfer-quantity-invariants.test.ts tests/transfer-guidance.test.ts tests/transfer-reconciliation.test.ts --maxWorkers=1
```

Focused ESLint, whitespace checks and clean-baseline patch-application checks passed. The preceding 114-test correctness candidate passed scoped TypeScript checks covering its changed production/tests plus imports with a 512-MiB cap, after a Functions-wide attempt exceeded a 384-MiB cap. Those checks were on 2026-10-17. The initial 2026-10-18 security handoff ran lightweight tests and lint while the main worker held the exclusive heavy-operation slot. The later authorized validation run is documented separately above, including full current semantic checks, builds, emulators and browser results.

The remainder-cancellation emulator fixture declares the request allocation it creates. It is exercised against the real posting engine in the validation follow-up, alongside interruption recovery and partial-serial cases imported from `tests/helpers/transfer-recovery-security-cases.ts`.

**Remaining coordinated verification:** integration with the separate financial candidate, production Node 22 parity, broader discrepancy interruption recovery, full repository acceptance and production-like load. The later validation exercised real Auth/Firestore/Functions, the posting extension, competing SDK transactions and desktop browser flows; it does not establish full release readiness.

The original deployed-baseline regression proof remains in `../stock-transfer-baseline.log`: 31 packages posted 30 units, 100 packages posted 30 units, and repeated cancellation reduced another transfer's reallocated request demand. Those three failures belong to the preserved original patch check, not a claim that the expanded fixture suite ran against deployed code.

## Coordination state

Parent thread `01a11fd5-c4d0-702b-85b6-79cc9c4e80d3` returned “thread not found” through the local app messaging tool, including after renewed parent coordination instructions. The initial direct status message to integration worker `01a148ee-6af5-7314-8183-8b3dd9bc4031` was denied by automatic approval review because coordination must go through the parent. That denied direct message was not retried, and no access/settings changes or alternate direct route was attempted.

The executor is responding and the candidate is intact. Parent has since relayed continuation and store/warehouse instructions, which are incorporated above. The specific security approval was later relayed and findings 1–2 are now implemented. The parent later released the heavy-operation slot for this validation run. Integration/release remains with the parent; process cleanup and slot release are reported in the final validation handoff. The platform's final-result handoff is the available parent delivery path.

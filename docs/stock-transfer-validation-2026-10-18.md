# Transfer validation follow-up — 2026-10-18

Base: `066c0e95efadd2f4cdc1dea25debc8e926fff165`, in the isolated `stock-transfer-review` worktree. This records the correctness candidate plus the specifically approved action/retry security changes, with the current reviewer-fix validation boundary stated below. The financial candidate has not been merged into this worktree.

## Final validation after source clearance

The parent relayed Astra's source re-review of SHA-256 `3b131c22e809fb61ca9439d34417d3549ae9ac7a7ffad31301047656867ba14d`, with no remaining P0/P1/P2 findings, then released the exclusive heavy slot. This run revalidated that production revision; it did not rely on the earlier SHA-126f7746 heavy results. All production files remain byte-identical to the Astra-cleared source. Only emulator tests and handoff evidence were added after clearance; the comparison is saved in `../stock-transfer-source-cleared-comparison.json`.

| Current gate | Result |
| --- | --- |
| Full Functions semantic check and emitted build | Passed with a 768-MiB Node heap |
| Full root semantic check, including expanded E2E helpers | Passed with `--noEmit --incremental false`, 768-MiB heap |
| Production web build | Passed with `next build --webpack`, `CIRCLE_NODE_TOTAL=2`, 768-MiB heap; no typecheck bypass |
| Offline regressions | 177 passed / 11 files |
| Real-engine workflow and repair regressions | 28 passed / 7 files |
| Normal parallel callable contention | 2 passed / 1 file |
| Focused lint and patch verification | Zero warnings; clean application and byte-for-byte reproduction |
| Supported desktop browser | Passed dispatch recovery, receipt/closure, source approval, partial receipt and late receipt; no console errors |

The real-emulator cases now explicitly exercise each repair: an authorized W1 editor cannot substitute an active W2 inventory location while retaining W1's ID; a valid W1 bin change succeeds. Cancellation, reservation and release each inject a failure solely in the response-cache completion transaction after the real business transaction commits. They verify terminal/changed business state with a still-pending command, deny removed source assignment, different actor and changed payload, then recover the original recorded result through actual callable transport after the workflow version advances. Stock balances and business-event counts remain unchanged. The expanded remainder-cancellation scenario verifies a fresh-key zero-delta no-op, exactly one real cancellation outbox event and conserved request allocation through later receipt and reallocation.

The workflow Functions worker was sequential to bound memory; the additional three cache cases execute the real Firestore transaction path in-process before transport retry. The separate contention run used normal parallel Functions workers. Java was limited to 512 MiB/two processors, and CLI/test Node heaps to 384 MiB. All work used synthetic `demo-ramadan-warehouse` fixtures.

Browser QA repeated on this production build: **Resume saved dispatch** completed an interrupted four-unit movement; receipt showed 4 received / 0 remaining, and **Validate and close** reached **Closed**. The simple store flow created and approved 3 units, received 1 with 2 still expected, then received the late 2 and reached **Completed**, 3 received / 0 expected. Current screenshots are `../stock-transfer-reviewed-browser-receipt.jpg` and `../stock-transfer-reviewed-browser-complete.jpg`. The owned browser tab and localhost server were closed.

Current logs use `../stock-transfer-reviewed-*`: Functions build, web typecheck/build, offline tests, lint, emulator workflows/concurrency/server and browser seed/server. No production change was needed during these gates. `../stock-transfer-final-validation.patch` applies test/evidence additions to the preserved `../stock-transfer-source-cleared.patch`; the revised unified patch contains the exact final candidate. Financial integration, full repository acceptance, Node 22 parity, production-like volume and broader discrepancy interruption recovery remain outside this validation.

Shared GNOME idle inhibitor PID **45023** was confirmed at the start and was not stopped by this run, but was absent at the final check. Idle inhibition was restored using the same GNOME method; replacement shared PID **97394** is verified active and preserved for the parent. Its PID is also saved in `../stock-transfer-shared-inhibitor.pid`. Display power is on, idle blanking is 0, dimming is false and screen locking remains enabled. Only owned compiler/test/emulator/web/browser processes were stopped; the final listener/display/inhibitor check is in `../stock-transfer-reviewed-process-cleanup.json`. The laptop was not shut down. The heavy slot is released at final handoff.

## Current revision after independent review

Astra reviewed the 25-file patch with SHA-256 `126f7746f072a03c100e802f0c6b4581f1b69b6512b7587ff69f48321a8f39c1`. The parent authorized source/focused fixes within the existing location-action/retry scope while the financial worker holds the heavy slot. This revision reproduces and fixes all three reported blockers:

1. **Draft routing:** warehouse and destination-branch identity are fixed after creation, because the transfer number, approved request ownership and transit/damage locations depend on them. Active bin changes within those original units remain allowed. The business transaction reads both units and both proposed inventory locations, verifies current organization/status and exact warehouse/branch linkage before changing any line or allocation. Keeping warehouse W1 while substituting a W2 location, a foreign organization location or an inactive destination is rejected. Changing either unit requires cancellation/recreation; no assignments or grants are broadened.
2. **Commit-before-cache interruption:** cancellation, reservation and release now save their response in their existing business-operation transaction. A verified pending command can recover that committed response before older terminal/version/quantity guards run. Recovery still checks current action, source/reading authority, working context, exact actor/action/entity/payload binding and committed operation organization/actor/action/entity/status. The response cache completes atomically with this authorized recovery. A version-1 binding created by the preceding candidate can recover a matching older operation without response details, returning only conservative no-op flags; unbound historical records remain review-only. No stock or historical binding is reconstructed.
3. **Fresh-key partial cancellation:** when there is no remaining undispatched/uncancelled quantity and item/header/reservation evidence reconciles, a new key records a completed no-op operation. It does not change transfer/request/reservation state or emit another event, audit or outbox row. Missing or inconsistent zero-remainder evidence requires review.

The new fixture failure injection targets the precise command-cache completion transaction, after the business transaction has committed. It does not fail the initial pending binding or business commit. Tests cover full cancellation, reservation and release; removed assignments/permissions, changed actor/payload, later workflow version, old bound response compatibility and mismatched operation provenance. Mutation flags, including `remainingCancelled`, are false on replay.

**Current verification:** 177 offline tests pass across 11 files, focused ESLint passes with zero warnings, and clean patch reproduction passes. The legacy fixture now uses the actual integration-event builder and outbox writer against its staged transaction store, exposing the real duplicate-create failure instead of mocking it away. Ten failing tests were captured before the fixes; thirteen reviewer regression cases are included in the final suite. The existing real-engine remainder-cancellation E2E source also now asserts a fresh-key no-op and exactly one cancellation outbox event.

**At the source-only handoff**, these repairs had not yet repeated semantic/build/emulator/browser gates because financial held the slot. Astra subsequently cleared the repaired production source and the final validation above completed the new gates. The older heavy results below remain historical evidence for SHA-126f7746.

Artifacts: `../stock-transfer-workflow-pre-review.patch` preserves the exact reviewed candidate; `../stock-transfer-review-fixes.patch` applies these changes to it. `../stock-transfer-workflow.patch` is the revised complete candidate. Reproduction evidence: `../stock-transfer-review-blockers-before.log`, `../stock-transfer-review-fixes-tests.log`, `../stock-transfer-review-fixes-lint.log` and the updated package-verification manifest.

## Additional defect found and fixed

Repeated partial receipts on the same dispatch could share an integration-outbox key. The event helper selected `dispatchId` before `receiptId`. If two receipts both left the transfer partially received, the second receipt committed its stock movement and atomic progress marker, then failed metadata finalization with Firestore `ALREADY_EXISTS` on `integrationOutbox`.

The occurrence identity now prefers the individual receipt ID. The transfer remains the integration event's entity, and its payload still includes the dispatch and receipt references. Each legitimate receipt has one event, while repeated/concurrent confirmation of the same receipt still finalizes once. Existing outbox records are not rewritten and historical stock is not repaired.

The real-engine regression receives two different serials in separate partial receipts while two further units remain undispatched. It verifies distinct outbox keys, exact serial locations, aggregate received quantity and identical concurrent confirmation behavior. This case failed before the event-identity fix and passes after it.

The semantic checks also found an unsafe generic response assertion in the command wrapper. Its replay copy now retains the inferred response shape while a mutable record view clears boolean mutation flags. This preserves runtime behavior and satisfies both Functions and application type checking.

## Prior heavy validation of the reviewed candidate

| Check | Result and scope |
| --- | --- |
| Functions semantic check and emitted build | Passed, full `functions/tsconfig.json`, Node heap capped at 768 MiB |
| Application semantic check | Passed, full root configuration including tests/imports, `--noEmit --incremental false`, 768 MiB heap |
| Production web build | Passed, `next build --webpack`, `CIRCLE_NODE_TOTAL=2`, 768 MiB heap, synthetic demo environment; no skipped type errors or build-config edits |
| Offline workflow/security/UI regressions | 164 passed across 11 focused files |
| Real-engine emulator workflows | 24 passed across 7 files, including the two additional cases imported by the existing remainder-cancellation E2E file |
| Normal parallel callable contention | 2 passed in `transfer-concurrency.test.ts`; two reservations cannot oversubscribe stock and two competing receipts cannot over-receive the dispatch |
| Focused ESLint and whitespace | Passed for changed transfer production code and tests |
| Patch reproduction | Unified patch applies to deployed base; validation delta applies to the preceding unified candidate; security/follow-up delta applies to the preserved correctness candidate. All reproduce candidate files byte for byte. |

Emulators used only `demo-ramadan-warehouse`, synthetic Auth accounts and Firestore fixtures. Java was capped at 512 MiB with two active processors; CLI/test Node heaps were capped at 384 MiB. Workflow runs used the Functions emulator's shared sequential worker to conserve RAM. Their injected interruption cases execute real Firestore transactions and the actual inventory posting engine in-process; only the before/after response failure is injected. Concurrent identical serial confirmations execute concurrently against Firestore in that test process. A separate emulator run omitted debug/sequential mode and verified actual parallel callable requests with independent Functions workers.

The interruption case checks failure before a movement, a lost response after stock commit, a still-draft header with an active execution lock, unchanged stock on retries, altered payload and actor denial, a fresh-key payload change denial, partial receipt interruption, destination reassignment denial before cache replay, and exact final balances. The existing remainder-cancellation case checks allocation release, repeat cancellation, subsequent receipt fulfilment and reallocation of only the outstanding request demand. Existing serial, lot, return, transit-loss and simplified-callable suites also pass.

The concurrency fixture now supplies complete package ownership and version-2 immutable dispatch evidence, rather than relying on ambiguous historical rows. The new recovery cases live in `tests/helpers/transfer-recovery-security-cases.ts`, imported by the already emulator-only remainder-cancellation test. Its original setup/cleanup hooks are scoped to its describe block. The offline fixture resolves `FieldValue` through the Functions package so its public sentinel equality check also works when web and Functions install separate Admin SDK copies. No shared package scripts or authorization helpers were edited.

## Desktop browser QA

The supported in-app browser exercised the production build at `http://127.0.0.1:3106`, using a disposable demo account. Production browser tabs were untouched.

- A synthetic dispatch was interrupted after its real stock movement but before metadata finalization. The page displayed **Resume saved dispatch**. Clicking it completed the saved confirmation; the page then displayed 4 dispatched. **Receive all in good condition** completed the exact outstanding receipt, showing 4 received and 0 remaining.
- The simplified store-only flow created a three-unit transfer, confirmed the source hold, received one unit while two remained expected, then received those remaining two. The final page displayed **Completed**, 3 received and 0 still expected.
- Browser console error capture was empty. The owned browser tab and localhost web server were closed after QA.

Evidence outside the patch: `../stock-transfer-browser-receipt.jpg`, `../stock-transfer-browser-complete.jpg`, emulator/typecheck/build/lint logs, and `../stock-transfer-package-verification.json`. The browser seed was guarded by exact local emulator hosts and the demo project; its intentional failure was confined to the seed process, with no production hook added.

## Process and display handoff

The parent released the exclusive heavy slot for this run. The first validation run stopped its owned compiler, test, emulator and web-server processes and released its own sleep inhibitor. The final run preserves replacement shared idle inhibitor PID 97394 after detecting that the original parent PID 45023 was absent; only validation services are stopped. The laptop is not shut down.

The explicit display-on request was verified through GNOME's display power property: `PowerSaveMode=0`; idle blanking was set to 0 and dimming to false. Screen locking remains enabled. Sleep settings were already `nothing` on AC and battery and were not changed. The original values are saved in `../stock-transfer-display-original.json` for restoration by the parent when all ongoing work finishes. Display-on settings remain in effect because other work continues.

## Remaining boundaries

This is a locally validated candidate, not a release or deployment. It does not validate integration with the separate financial candidate, full repository acceptance, production-like volume, mobile/offline browser behavior, all role combinations in the browser, or Node 22 runtime parity; this laptop ran Node 24.20.0. Existing detailed discrepancy recovery remains the older multi-step process documented in the main handoff. Historical ambiguous evidence still requires review; no backfill or automatic stock repair was performed.

Artifacts: `../stock-transfer-workflow.patch` is the complete candidate. `../stock-transfer-validation.patch` applies only these follow-up changes to `../stock-transfer-workflow-pre-validation.patch`. The preserved initial and correctness patches remain unchanged. No push, PR, publication or deployment occurred.

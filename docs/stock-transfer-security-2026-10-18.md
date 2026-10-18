# Approved transfer action and retry security — 2026-10-18

Specific approval was relayed from the parent: “may I restrict transfer actions to authorized branches and tighten retry validation?” → user “Yes” (question `Sentinel_f5b91801c6c481918780ca50806d395d`, answer `Sentinel_b2d469c0b9a88191904bb94a7a69eadf`). This candidate implements findings 1–2 alongside the previously authorized correctness work. It does not add role grants, repair historical stock, publish or deploy anything.

## Action authority

A new transfer-only `securedTransferCallable` boundary guards every exposed legacy mutation before its original business handler, including handlers that previously returned old idempotency results before checking scope. Read endpoints keep their existing reading/cost-filter policy.

| Action family | Required authority |
| --- | --- |
| Creation, draft editing, submission/review/approval/rejection, reservation/release, picking/packing/verification, dispatch, cancellation, closure | Existing action permission and assigned source warehouse, or an existing exact organization-wide action grant |
| Receipt draft/confirmation | Existing receipt permission and assigned destination branch, or an existing exact organization receipt grant |
| Discrepancy report | Existing report permission and assigned source **or** destination, or an existing exact organization report grant |
| Discrepancy assignment/resolution | Existing resolution permission and assigned source, or an existing exact organization resolution grant |
| Transfer cost actions | Assigned source plus the existing action permission; existing explicit organization finance cost authority is retained |
| Logistics resource catalog maintenance | Existing dispatch permission plus authorized source-warehouse context or exact organization dispatch authority; this does not invent location ownership fields for the existing organization catalog |

`transfers.read.all` never supplies mutation authority. A scoped manager paired with a read-only operations, finance or auditor base remains scoped. Built-in organization action grants are taken from the directly assigned role's own permission catalog, not the union contributed by another role. Active custom operations grants are loaded and honored only for the exact action on that role. Explicit finance cost grants remain limited to cost actions. Existing maker/checker rules and manager self-authorization behavior are retained; this patch does not redesign financial approval policy.

Every transfer replay also requires the current transfer reading authority. Child references and identifiers returned by earlier creation results must still belong to the same organization/transfer; receipts must belong to the selected dispatch. Creation retries recheck the original created transfer's current source as well as the requested source.

Legacy source scope uses its existing `originWarehouseId`; destination scope uses `destinationBranchId`. The active simplified flow already supports its established branch/warehouse sources and branch destination. No entity types were merged, no warehouse was added to the store-only picker and no destination type was broadened.

## Draft routing and committed retry recovery

The independent-review revision keeps the created warehouse/destination-branch identities fixed and transactionally validates proposed bins against those original active organization units. Cancellation, reservation and release persist their business response atomically with their operation; authorized exact pending retries recover it before terminal-state guards. Recovery verifies both current authority and original binding/provenance. Fresh-key zero-remainder cancellation records a no-op without duplicate events, provided item/header/reservation evidence reconciles. These are restrictions and retry corrections within the supplied approval; no grant, role or rule is broadened. See [Current revision evidence and pending heavy checks](stock-transfer-validation-2026-10-18.md).

## Working location

Transfer-specific context narrowing prevents a broad read-only base role from bypassing the selected working location of a scoped action. Multiple relevant assignments require an explicit context. Invalid/unassigned contexts are denied. Switching to another assigned location still cannot replay an action belonging to the original source/destination. Exact organization-wide authority is evaluated per action and retains its existing organization-wide behavior.

The active simplified flow receives the same mutation-only context enforcement; its discovery and read behavior are unchanged. Shared `auth/authorize.ts` and shared frontend context helpers were not edited.

## Retry contract

New legacy command bindings use server-owned documents in `idempotencyKeys` under an organization-scoped `transferCommand` namespace. They record security version, authenticated actor, canonical action, entity identity and SHA-256 fingerprint of normalized parsed business input.

- Authorization, selected context and current parent/child ownership are checked **before** returning any replayed result.
- Reusing a key for a different actor, action, entity or business payload returns `permission-denied` with `TRANSFER_RETRY_MISMATCH`; the business handler does not run.
- Parsing applies declared defaults and string trimming. Object key order and omitted-versus-undefined optional fields do not change the fingerprint. Array order remains part of the declared payload. Unknown ignored fields and the transport working context are not business payload; the working context is independently reauthorized on every call.
- Completed authorized exact replays return the cached response with mutation flags false and `repeated: true`. They do not repeat ledger, request allocation or metadata effects, even after the business document reaches its terminal state.
- Pending bindings are written before business execution and retained through failure. A matching request can resume; another actor cannot take over that **key**. An independently authorized actor may use its own fresh key to resume the same entity's unchanged frozen stock plan, preserving the established source/destination operational policy.
- Original business-operation records remain the atomic deduplication guard for concurrent identical commands. Packing verification and discrepancy assignment previously lacked those records and now write their completion records atomically with metadata. The command-result cache is finalized separately and never overwrites an already completed cache.
- Where an older operation/resolution record exists without a trustworthy command binding, the call returns `failed-precondition` with `TRANSFER_RETRY_REVIEW_REQUIRED`. No historical binding is inferred, rewritten or backfilled. Do not change a key to force stock repair.
- Stock execution plans additionally bind the full normalized confirmation input, excluding the client key. A fresh key cannot alter the frozen instructions of an unfinished or completed plan. Older plans lacking that evidence require review.
- `updateTransferPackage` remains the existing alias of the same canonical package command; it does not create a second action namespace.

This is a prospective public-callable security boundary. Internal reservation/posting helpers remain trusted server capabilities; future callers must use the secured entrypoints or enforce equivalent authorization and retry binding themselves.

## Verification and release boundary

**177 tests pass across 11 lightweight files**, preserving the prior 114-test correctness suite, 50 security cases and 13 reviewer regressions. They cover the source-action matrix, destination receipt authority, source/destination discrepancy reporting, broad-read role combinations, exact global custom grants and their removal, retained manager self-approval and finance cost approval, actor/action/entity/payload mismatches, changed child ownership, reading-permission removal, source/destination reassignment, selected-context changes, creation retries, cross-organization replay, historical-key review, pending recovery, terminal cancellation replay and identical concurrent metadata commands.

Focused ESLint and whitespace checks passed. The unified patch applies cleanly to deployed base `066c0e95efadd2f4cdc1dea25debc8e926fff165`. A separate security delta applies to the preserved correctness candidate. Both patch checks reproduce the candidate files byte for byte.

The initial source-only handoff deferred heavy checks while the main worker held the slot. The parent subsequently released it for this candidate. Prior semantic checks, production builds, real-engine emulators, parallel callable contention and synthetic browser checks apply to the SHA-126f7746 candidate. The repaired source was subsequently cleared by Astra at SHA-3b131c22 and revalidated with full semantic/build gates, 30 real-emulator tests and desktop browser QA. The production files are unchanged from that clearance; all stages are distinguished in [Validation follow-up](stock-transfer-validation-2026-10-18.md). Integration with the separate financial candidate remains pending. Existing detailed discrepancy inventory resolution retains the limitations documented in the main handoff; action/retry protection does not make that process fully atomic.

Preserved artifacts: `../stock-transfer-workflow-original.patch` (initial two corrections), `../stock-transfer-workflow-correctness.patch` (findings 3–7), updated unified `../stock-transfer-workflow.patch`, and `../stock-transfer-security.patch` (approved security plus the validation corrections). `../stock-transfer-validation.patch` isolates changes since the preceding source-only unified handoff.

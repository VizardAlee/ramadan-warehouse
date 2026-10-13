# POS and prerequisite guidance release audit — 13 October 2026

This document maps all original read-only audit findings to the current implementation. The previous “60 findings / 37 rules” checkpoint was inaccurate: the reports contain **58 original findings (18 operations + 28 sales/finance + 12 administration/HR)**. Two additional finance concerns were cross-cutting observations, not original matrix rows. Shared rules cover multiple findings; rule count is not a completion score.

## Implemented behavior and limits

The shared Button displays visible, described requirements beside matched disabled actions. Workspace help remains keyboard-openable for hidden actions. Links require the viewer's existing effective destination permissions. Specific dynamic first-unmet messages are implemented in POS checkout, count creation and detailed pick/pack/dispatch. Other mapped actions receive contextual prerequisite/resolver checklists: this is useful guidance, **not exhaustive first-unmet diagnosis**.

Processing marked aria-busy or rendered with a spinner suppresses setup help. First/last page, routine Cancel/Close/Refresh and retry controls are excluded. Business cancellation labels remain covered. Most-specific action matching prevents invoice approval receiving purchase-order instructions. Raw HTML buttons, disabled inputs/selectors, absent actions and enabled actions rejected by the server are not automatically annotated. Generic server errors remain sanitized; this release does not invent diagnostic codes or expose arbitrary messages.

No permissions, credit limits, account mappings, backend source, Firestore rules, IAM, App Check or business records change. Ordinary credit authorization remains mandatory; the existing system-administrator direct-credit exception remains. Missing wholesale price does not become an invented price. Deliberately changing a tier replaces an order-only price override, while customer default selection preserves it. A positive discount still requires an actual reason of at least three characters.

## Operations mapping

| Finding | Implementation | Remaining limitation |
|---|---|---|
| O1: Stock-count draft: no eligible counter / no location | /inventory/counts | Selected counter revalidation and loading/storage remain distinct existing guards. |
| O2: Detailed-transfer dispatch has several silent prerequisites | /transfers pick/pack/dispatch | First missing source/packages/driver shown; processing help suppressed. |
| O3: Detailed pick/pack: no eligible preparation quantity | /transfers pick/pack/dispatch | First missing reserved/picked quantity shown; processing help suppressed. |
| O4: Missing catalogue/source stock or eligible destination for a simple transfer | /transfers source/destination | Empty choices retain generic resolver, not a derived missing-choice diagnosis. |
| O5: Purchasing: Create draft order lacks a first-missing-input explanation | /procurement create | Checklist does not identify the first empty supplier/location/cost field. |
| O6: Purchasing: receipt quantity/lot/serial blocker | /procurement receive | Checklist does not derive remaining quantity or serial/lot completeness. |
| O7: Supplier invoice match: no received uninvoiced goods | /procurement invoice | Exact invoice action matched; absent versus already invoiced goods not diagnosed separately. |
| O8: Supplier payment/apply advance: disabled action with unclear amount/account/reference | /procurement payment | Static requirements do not compute exact allocation or account deficit. |
| O9: Supplier return: no original receipt / line selection / credit list / confirmation | /procurement supplier return | Receipt/select locks still need specific state explanation. |
| O10: Supplier correction: physically-returned-goods confirmation | /procurement reversal | Physical confirmation/reason described, not individually diagnosed. |
| O11: Product tracking locked after stock history / service-only fields | /products create/save | Immutable tracking/service fields do not each receive adjacent help. |
| O12: Catalogue import validation prerequisites | /products validate/import | Upload/map/error-specific blocker is not derived. |
| O13: Inventory posting scope and decrease-cost lock | /inventory posting | Disabled decrease-cost field and direct permission panel are not individually annotated. |
| O14: Inventory count workspace is read-only due to state or counter assignment | /inventory/counts | Read-only count inputs do not each identify state versus assignment. |
| O15: Request decisions require every unit and a meaningful reason | /requests decision | Exact cancellation matcher repaired; review-only approval UI mismatch remains governed by server. |
| O16: Request submission/edit state and empty branch/products | /requests save/submit | Enabled invalid saves and submitted inputs retain existing validation/state feedback. |
| O17: Detailed transfer linked-request locked fields and reserve visibility | /transfers linked workflow | Locked selectors and unsupported serial/lot interface are not replaced by this change. |
| O18: Simple transfer note, zero quantity and requested-state decision | /transfers source decision | Generic requirements do not precompute decision/quantity failures. |

## Sales and finance mapping

| Finding | Implementation | Remaining limitation |
|---|---|---|
| F01: P1 POS `src/app/(protected)/pos/page.tsx:1421–1458` | POS shift | Existing online/shift guidance retained. |
| F02: P1 POS `:1548,1573` | POS Add | Missing product states receive general stock/catalogue resolver. |
| F03: P1 POS `:1887–1899,1928–1935` | POS dynamic credit/advance | Named customer/online requirements shown; selected advance amount remains existing UI. |
| F04: P1 POS `:1976–2000` and server `functions/src/callable/sales.ts:1570–1583` | POS dynamic ordinary credit | Administrator direct-credit exception preserved. |
| F05: P1 POS `:1952,2034,2096,2125–2160` | POS dynamic receiving account | Single/part card-transfer has empty-account hint; split remains allocation guidance. |
| F06: P1 POS service `src/features/pos/service-line-options.tsx:17–29` | POS service/provider link | Provider/case/mapping conditions are a checklist, not individually detected. |
| F07: P1 Mixed setup `src/features/accounting/billing-controls.tsx:13` | Finance reviewed mappings | Dedicated distinct accounts and reason described; no empty-list diagnosis. |
| F08: P1 Customers `src/app/(protected)/customers/page.tsx:653–756` | Customer payment/advances | No derived exact allocation difference/advance maximum in shared help. |
| F09: P2 Customers `:592–601,721,752` | Customer save/arrangements | Name/reason minima remain local validation; deactivation workflow described. |
| F10: P1 Returns `src/app/(protected)/returns/page.tsx:453–535` | Returns submit | No shared first-blocker or empty-till diagnosis. |
| F11: P1 Returns `:571–588` | Returns approve | Inspection/stock-release/funding described; existing own-work guard retained. |
| F12: P1 Returns `src/features/returns/return-follow-up.tsx:23,41–54` | Returns inspection/refund | Individual missing dispositions not enumerated. |
| F13: P1 Returns held `src/features/returns/held-return-disposition.tsx:46–60`; replacement `held-supplier-replacement.tsx:25–35` | Returns and Aftersales held goods | Aftersales held action labels added; underlying stages unchanged. |
| F14: P1 Receipt correction `src/features/accounting/billing-receipt-corrections.tsx:17` | Returns actual receipt correction | Exact receipt/provenance ceiling remains server-controlled. |
| F15: P1 Aftersales `src/app/(protected)/aftersales/page.tsx:180–205` | Aftersales create | Customer/store/complaint described; missing-customer setup is delegated. |
| F16: P1 Aftersales `:236–255` | Aftersales assignment/charge | Charge-before-completion and HR resolver described, including valid complimentary charge. |
| F17: P1 Aftersales `:260–264`, `src/features/returns/service-payments.tsx:65–78` | Aftersales payment/refund | Cash-on-hand semantics retained; no fictitious till requirement. |
| F18: P1 Expenses `src/app/(protected)/expenses/page.tsx:273–275,407,607–617` | Expenses payment/draft | No derived exact amount/account deficiency in shared help. |
| F19: P1 Provider `src/features/accounting/provider-funds.tsx:22–24` | Expenses provider payment/recovery | Exact provider labels added; no derived maximum or missing settlement diagnosis. |
| F20: P1 Banking transfer `src/features/banking/company-funds-transfer.tsx:67–82` | Banking actual transfer | Two distinct accounts and actual movement acknowledged; no banking initiation. |
| F21: P1 Banking match `src/app/(protected)/banking/page.tsx:448–548` | Banking match | Equal signed amount/31 days/unused line described; candidate failure not individually derived. |
| F22: P1 Banking prepare/complete `:567–713` | Banking prepare/complete | Existing balance/match readiness retained; no added per-row source links. |
| F23: P1 Journal `src/features/accounting/journal-workspace.tsx:112–147` | Finance journal/reversal | Balanced/store/account and operational-control boundaries described. |
| F24: P2 Budget `src/features/accounting/budget-workspace.tsx:79–84`; comparison `budget-comparison.tsx:26–27` | Finance budget/comparison | Reason minimum/12-month range described; empty account list not separately diagnosed. |
| F25: P1 Month close `src/app/(protected)/accounting/page.tsx:265–283,368–413` | Accounting month close | Existing source blocker list retained; per-blocker permission-safe links remain absent. |
| F26: P2 Tax `src/app/(protected)/tax/page.tsx:89–102`; `tax-rule-workspace.tsx:63–81` | Tax propose/review/preview | Reviewed authoritative source/qualified accountant required; no guessed rule. |
| F27: P2 Reports `src/app/(protected)/reports/page.tsx:142–158,470–576`; margins `src/features/reports/product-margins.tsx:27–31` | Reports export/margins | Range/result/cost-access/unknown semantics retained; hidden panel not dynamically diagnosed. |
| F28: P2 Customer statement `src/features/customers/account-statement.tsx:23–41,65–84` | Customer complete statement | Exact print/export labels added; historical reconciliation delegated to accountant. |

## Administration, HR and access mapping

| Finding | Implementation | Remaining limitation |
|---|---|---|
| ADM-01 | Role reassignment/migration checklist | Specific server role conflict codes still generic; no backend changes made. |
| ADM-02 | Guide per-step action permission gate | Read-only catalogue access no longer links to creation instruction; tested with products.read. |
| ADM-03 | Explicit No manager handoff | Users loading/error versus no eligible manager not separately diagnosed. |
| ADM-04 | Administration relationship checklist | Empty Related store/user assignments still need adjacent empty-choice diagnosis. |
| ADM-05 | Administration register checklist | Head Office duplicate error still generic; existing server protection unchanged. |
| HR-01 | Employee page hint; split action rules | Paging instruction present; employee creation no longer requires selecting existing employee. |
| HR-02 | HR register checklist + immutable Staff ID note | Duplicate staff/device/user conflicts still generic server codes. |
| HR-03 | HR separate compensation authority guidance | Omitted salary action does not individually display a resolver. |
| NOT-01 | Browser-push setup and deployment-operator resolver | Direct user gesture and browser permission behavior retained. |
| NOT-02 | Notification expected-task troubleshooting | No delivery outage or server setup status claimed. |
| RESET-01 | Reset prerequisite rule + BACKUP_NOT_VERIFIED mapping | No reset invoked; preview/backup/sign-in safeguards unchanged. |
| ACC-01 | Safe permission error + HR direct denial resolver | Some directly rendered Users/Roles denied panels remain generic. |

## Acceptance boundaries

Source audits and suggested cases are not executed test results. Release evidence records the actual focused/UI/unit/emulator checks separately. Financial posting tests run on synthetic demo data; live acceptance does not submit real sales, receipts, refunds or settings. First-unmet diagnosis for every selector/state/server rejection, exact admin/HR conflict translation and per-source month-close navigation remain follow-up work. This release does not claim the whole roadmap or client acceptance is complete.

The recorded live index planner audit checked 531 shapes with zero failures or missing indexes on 13 October; its baseline is tied to matching source fingerprints. Historical index-inventory metadata remains dated to its actual prior check.

## Targeted closure after reconciliation

The initial mapping above records the audit checkpoint before the last closure pass. That pass now implements:

- O1/O11/O14: selected-counter ineligibility, immutable product tracking/service fields and count stage-versus-assignment reasons.
- O4/O5/O6/O7/O8/O9/O10: empty transfer source/destination handoffs, actual purchasing creation/quantity/lot/invoice conditions, supplier payment scope/amount/advance/account/reference, supplier-return selection/credit-line/physical-confirmation and reversal requirements.
- F07–F12/F14/F17–F20/F23/F25: exact reviewed mapping, account/payment/refund/inspection conditions, provider original-settlement requirements, banking/journal prerequisites, and permission-gated month-close source destinations.
- ADM-01/ADM-03/ADM-04/ADM-05/HR-02: exact known public role/HR/Head Office error translations; loading/error/empty manager/store distinctions; immutable Staff ID. These use a finite client-side allowlist and preserve diagnostic codes. No backend or security surface changes.

The button remains the same DOM element when an explicit requirement clears. This preserves click/focus identity and fixed the return/refund regression. Existing inspection, safe retry and service-catalogue tests pass unchanged. New tests verify missing funding accounts, original receipt ceilings, distinct reviewed mappings, two-account prerequisites, safe error redaction and permission-gated source links.

Residual limits: serial completeness and unsupported detailed reservation/exception interfaces remain governed by original evidence/server checks; some enabled actions rejected by the server or raw controls use the nearby workspace checklist. Guidance does not claim to implement absent workflows or exhaustive live acceptance for every role.


## Bounded guidance follow-up

The follow-up corrects obsolete serialized POS and collection-paging wording against current support: exact online serialized units, at most 50 serials per order, reservation at final confirmation and retained original-unit collection/return evidence. No batch POS or detailed transfer exception interface is introduced.

Available mapped actions now expose keyboard-openable Action requirements beside the control, including after rejection. Small icon controls avoid repeated disclosure layout; their existing local checks remain. Known public server failures receive finite safe recovery translations, including bank row caps, receipt/account selector limits, service/invoice reconciliation, mappings, journals, budget versions, tax coverage and own-user access. Arbitrary server messages remain redacted.

Inventory reconciliation checks actual adjacent guidance, contextual requirements, processing/obvious states and protected conditions with authorized next steps. Confirmed missing explanations in import validation, the final request line, supplier identity, physical collection, photo description and included-part capacity are closed without changing their disabled expressions. The final control-inventory report records classifications and source evidence. Source coverage is distinct from live all-role acceptance; server-only protected/dynamic failures retain safe diagnostic and responsible-team handoff.

# Sales voucher, receipt and store release

Status: the voucher, cashier confirmation, pending waybill and separately authorized collection flow was deployed in `c9ffcee35ddcb46a658b4974e36c45b078ccfbb7` (PR #16), App Hosting build `build-2026-11-06-004`, with 182 ACTIVE Functions and the full 25-stage production gate. Live verification was read-only; production financial and stock posting paths were not exercised for testing. The follow-up cancellation and customer ownership workflows described below require their own exact-commit release evidence; their live deployment status must be taken from the associated pull request and verified runtime/build, not inferred from the earlier PR #16 release.

The user approved this workflow on 2026-11-06. Cashier and store officer may be the same person or different people. Each action must independently pass its existing permission and branch checks and record its own actor. Existing approved-credit and part-payment eligibility remains in force. This does not grant any new permissions.

1. Sales creates and can print a sales voucher from the order snapshot. It does not receive money, create debt, issue goods, or imply that goods have been handed over.
2. The cashier accepts and confirms the payment or eligible credit arrangement. The atomic posting issues the receipt, posts the existing financial entries once, and reserves physical goods. A printable pending waybill clearly says that store confirmation is outstanding and is not proof of collection.
3. The authorized store officer confirms the actual quantities and serial identities handed over using the existing collection command. Only that action releases those physical goods. Each partial collection retains its own immutable waybill, actor, quantities and idempotency evidence.

## Existing implementation points

- `confirmPosSaleOrder` now reserves physical goods regardless of the client’s `deferCollection` value. Cashier confirmation checks its own payment permission.
- `commitPosSale` retains the compatibility path with independent sales creation, payment acceptance and payment confirmation permissions. It reserves physical goods, records the combined authorized actor provenance, and preserves historical fingerprint retries. It does not release physical goods.
- `collectReservedSale` already requires `sales.stock.release` and supports partial quantities, serial reservations and accounting. Retain those invariants and cancellation/refund behavior.
- Included service parts are separately issued by `includedIssues`, even when goods are reserved. Preserve their existing service-cost/consumption semantics; do not accidentally reserve or reissue consumed service parts as customer collections.
- Distinguish goods reservations from service fulfillment. A service-only bill must not fabricate goods awaiting collection.
- Existing completed invoices, receipts, collections and actor history are immutable. Do not retrospectively change their posting or ownership.

## Required verification

Test same-person and different-person workflows, each missing permission, selected and unauthorized branches, client attempts to force immediate issue, the direct posting endpoint, offline replay and interrupted confirmations, approved credit and part payment, rejected credit, service-only bills and included parts, partial collections, serial ownership, reservation cancellations, returns and financial balancing. Confirm printing a voucher or pending waybill has no posting side effect. Verify that the pending document is visibly different from a recorded handover waybill.

## Sales entered in error

Requesting, approving/rejecting, and completing a posted-sale correction requires an actual System Administrator assignment in addition to the existing action permission and branch checks. Operations Administrator and custom roles based on System Administrator do not qualify. The server checks this before idempotent replay; hiding controls in the browser is additional guidance.

This restriction applies to the dedicated mistaken-sale correction workflow. Ordinary customer goods returns, eligible uncollected-goods cancellations, payment receipt corrections, draft order rejection, and store collections retain their existing independent permissions. No historical invoice is rewritten, and this release does not reverse any live sale automatically.


## Standalone mistaken-sale cancellation

A System Administrator can request `cancel_without_replacement`, review the plan, process the genuine controlled returns/reservation cancellations/service credits and refund or debt reversal, then verify completion using all posted reversal numbers. No replacement invoice is required. Every original line and its full gross amount must be reversed with balanced posted journals and valid inventory evidence before completion. Original invoice amounts remain recorded; the document shows the linked mistaken-sale cancellation. Same-request retries retain their result without duplicating postings. An approved cancellation plan also restricts associated return processing to an actual System Administrator, including replay; ordinary returns outside this exceptional plan retain their existing permissions. Cash shifts remain owned by their original users/devices.

## Customer ownership review

Customers → All locations → Customer branch ownership review is restricted to actual System Administrators with customer management permission. It shows missing/invalid ownership, historical branches, tracked unpaid invoices, advances and account arrangements. No destination is preselected. The administrator confirms the customer number, reason and preservation of posted history. Changed evidence forces a refresh, and successful assignments retain a review record and audit log. Cross-branch history, unattributed activity, inconsistent or legacy unresolved balances and truncated evidence block reassignment; an accountant and business owner must resolve the facts before choosing an ownership or account-splitting policy. No automatic migration or historical rewrite is performed.

## Adjustment incident evidence limits

The reported rejection at 2026-11-06 13:49:06 UTC did not include an error message or submitted values. A read-only search of `postStockAdjustment` logs from 13:35–14:05 UTC returned no matching entries. This does not establish the original cause. The previously deployed form/server reason-length alignment is a confirmed defect fix, not conclusive proof of that incident. Invalid quantities, reserved stock, serial evidence, permissions and accounting-period controls must continue rejecting invalid adjustments.

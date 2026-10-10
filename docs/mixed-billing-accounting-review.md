# Mixed billing accounting review — implementation and release contract

The independent reporting/HR/budget checkpoint was validated before this mixed
billing implementation. The complete mixed billing and reporting batch
requires fresh integrated acceptance on unchanged source before publication. Deployment does not configure production account mappings or
change business data. Its base release is e6dd6f7.

## Confirmed business intent

- Recognize service income when payment is received, including the allocated
  portion of partial/split payments and consumed customer advances.
- Hold the delivery provider's portion as a pass-through liability. Only the
  retained portion is company income; settling provider funds is not an expense.
- Support separately charged physical parts and parts consumed internally within
  the service price, using distinct explicit modes and no double consumption.
- Reuse the existing supplier identity for service/logistics providers. Save its
  ID and name snapshot on linked jobs/bills/settlements; do not duplicate the
  supplier register or require sensitive banking details merely to register one.

## Confirmed accounting model; local implementation added; production reviewed mappings pending

Confirmed: at invoice, debit customer receivables for unpaid service gross and
credit an explicitly reviewed deferred-service control account. On payment,
release only the allocated service gross from that control: net to existing
service income `4100`, configured receipt VAT to existing VAT `2100`. Goods keep
existing invoice recognition, revenue `4000`, inventory `1200`, and COGS `5000`.
This preserves the existing service receipt VAT software behavior; it is not a
new legal/statutory VAT determination.

Delivery provider portions require an explicit dedicated liability mapping,
separate from accrued operating expenses `2300`, exchange credits `2200`, customer
advances `2210`, and accounts payable. Debit that liability when paying the
provider and credit the selected authorized cash/bank account. No numeric account
code has been selected, created or repurposed for either new control.

Existing account maintenance is guarded by `finance.accounts.manage`; manual
account maintenance deliberately excludes operational control codes. Therefore a
reviewed configuration needs both ledger account mapping and operational-control
protection rather than assuming any arbitrary liability account is suitable.
Mapping changes must be versioned, audited, scoped, and must not redirect existing
posted balances. Invalid/missing mappings must block only dependent posting.

## Implemented controls requiring final acceptance

- Immutable invoice item-kind, provider, parts-mode, price, VAT, cost and mapping
  snapshots; preserve legacy records and old clients without reinterpretation.
- Shared cumulative minor-unit allocation across invoice lines and every payment
  source, persisted recognition evidence, exact retry fingerprints and transaction
  concurrency guards. Partial payments release only cumulative differences; the
  final payment absorbs rounding residue.
- Later customer repayment/advance application uses original invoice allocations
  to release deferred service amounts; general unallocated receipts must not
  recognize service income speculatively.
- One linked service charge owner: existing aftersales receipts and mixed invoice
  receipts cannot both recognize the same charge. Existing legacy service cases
  retain their original accounting semantics.
- Goods and charged parts use stock reservations/collection and exact issue cost.
  Internal parts consume physical stock once, affect service cost without an
  additional customer charge, and retain evidence for serials and reversals.
  Service-only lines never reserve/release/return physical stock.
- Service commercial credits distinguish unpaid charge cancellation from refund
  of recognized income/VAT. Provider credits/refunds reverse their original
  liability/evidence rather than creating a duplicate expense. A completed case
  or stock handover alone must not recognize service income.
- All existing period locks, permissions, store scopes, settlement account checks
  and journal/subledger invariants remain enforced. No payroll or approval policy
  is introduced by this work.

## Release acceptance gates

Payment matrix: full/partial/split cash/card/bank, advances, credit and later
repayments, residual rounding, exact retries, concurrent receipts and reversals.
Physical matrix: goods/service-only/mixed bills, separately charged/internal
parts, partial collection, serial ownership, cancellation, returns, no duplicate
stock issue or cost. Provider matrix: original liability, partial settlement,
reversal, linked supplier identity, no duplicate bill or accrued expense.
Compatibility/security matrix: old sales/cases/payments, legacy clients, missing
or inactive mappings, permission/store/cross-organization denials, period locks,
audit evidence and statement/report reconciliation. The reporting checkpoint does not prove the mixed-billing gates. The final
release evidence must identify its tested source, passing gates, deployment
completion and live verification limits.

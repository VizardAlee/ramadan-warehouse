# Financial amount entry

Financial amount inputs show comma thousands grouping while editing, using the existing en-NG convention: `1234567.50` displays as `1,234,567.50`. The decimal separator remains a full stop.

## Contract

- `AmountInput` is a controlled display component. Its `onValueChange` receives a **comma-free string**. Keep using the existing amount parser and naira-to-kobo conversion; do not parse the displayed DOM value or introduce another round/scale conversion.
- Formatting operates on strings and never rounds, limits decimal precision, strips leading/trailing zeros, or converts currency. Blank, zero, negative and incomplete decimal drafts remain editable. Numeric React Hook Form fields use `Controller` and their original empty-to-undefined/number conversion.
- Former numeric fields reject non-decimal Number() syntax such as hexadecimal, binary and whitespace before a caller can parse it, including non-form actions. Incomplete numeric drafts remain visible and invalid on blur rather than becoming `NaN` or a coerced amount.
- Preserve `type="number"` on migrated former number fields. The visible control uses text for selection/caret support; a detached native number validator retains the original required/min/max/step constraints. Former text fields remain governed by their existing validation. Neither the formatter nor the caller clamps an out-of-range value.
- Default `inputMode="decimal"` offers a mobile decimal keyboard. Existing labels, descriptions, disabled/read-only behavior, forwarded focus refs, and financial privacy wrappers stay in place. The visible amount control is a textbox, rather than a spinbutton that can accidentally increment financial values.
- Caret mapping counts non-separator characters. Middle edits, selections, backward/forward deletion next to commas, touch input events, and IME composition are covered by regression tests. Max-length constraints count the raw value, not generated separators.
- Plain or correctly comma-grouped pasted numbers are accepted. Ambiguous decimal-comma or mixed-locale paste is rejected rather than silently changing its amount. Manually typing a comma does not change the amount; grouping is automatic. Drop events are prevented because their insertion point is not reliable across browsers.

## Coverage

The shared input is used at 46 entry sites in 31 files:

- POS: one-sale prices, discounts, split/partial payments, opening and closing cash, service provider funds.
- Catalogue and inventory: default costs, retail/wholesale/branch prices, opening/receipt/adjustment unit cost.
- Purchasing and supplier accounts: unit cost and payments.
- Banking: account/reconciliation opening and closing balances, reviewed initial balances, company funds transfers.
- Customers: credit limits, receipts and allocations.
- Expenses: net amount, VAT amount and payment amount.
- HR: salary entry.
- Accounting: budget amounts, journal debit/credit, provider settlement/recovery, receipt corrections and tax base.
- Branch trading: internal unit prices and payments.
- Quotes, returns and aftersales: custom quoted prices, discounts, provider credits, split resolutions, service charges/payments, refunds and sale corrections.
- Daily reconciliation: counted cash. Shared money-tender entry covers workflows that split money across accounts.

Intentional exclusions: four VAT/tax **percentage** inputs, nonfinancial quantities/stock levels/days, account numbers/identifiers, and bank-statement CSV text. No stored schema, financial parser, rounding rule, backend function, permission, live financial record or user assignment is changed.

`tests/amount-input-coverage.test.ts` guards the monetary sites and intentional rate exceptions. `tests/amount-input.test.tsx` covers lossless formatting, editing and validation. Existing privacy, sale-price, POS, banking, tender, inventory, procurement and quote tests verify the migrated integrations and unchanged submitted amounts.

## Release verification

Run focused input/UI tests, full lint, frontend/backend typechecks and the existing non-emulator suite before integration. The release coordinator must also run the existing exact-source CI/deployment gate and verify the released UI. Local jsdom caret/mobile-event tests are not a substitute for a real browser and physical mobile keyboard smoke test.

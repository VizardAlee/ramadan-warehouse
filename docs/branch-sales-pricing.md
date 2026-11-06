# Branch selling prices

Products → Branch prices lets authorized price staff choose an active branch and
review retail and wholesale overrides. POS → Store-wide price opens the same
editor for the current branch. No stock location, central selling-price record or inventory posting is needed
to configure pricing. Blank means inherit that level's central default; clearing
both restores central pricing. A missing central default leaves its level unavailable unless an administrator
explicitly approves a branch-only price. VAT is optional. Blank means explicitly not provided (stored as null), so no VAT
is added; it is distinct from an explicitly configured 0% rate. Without a central
record, branch VAT may be provided or left blank; changes to existing branch VAT
require administrator approval and a reason. Omitted VAT fields preserve existing
settings. No central record is
created as a side effect. Wholesale-only products are labelled and cannot be
sold as unconfigured retail. Inactive central records retain their block.

Existing central prices and existing retail branch records remain compatible.
Omitted fields from legacy callers preserve existing settings; explicit null
clears an override. The existing branch-price permission and its own granting
scope control saves. Prices below their corresponding central level require a
system administrator and a reason. Such approvals are valid only against the
central version that was reviewed; stale approvals fall back to central pricing.
Inactive branch price records also fall back. No roles or permissions are granted.

The shared resolver supplies POS, order intake, checkout, quotation presets and
new catalogue-linked service cases. Wholesale snapshots carry their effective
branch or central version and source. Stale online/offline price snapshots fail
for explicit review. Held carts resolve current levels when resumed; manual
sale prices retain their existing reason and review rules. Existing linked
service cases, saved quotations and posted sales retain their recorded terms.

Branch edits retain immutable versions and audit records, reject concurrent
editor saves using the displayed version, and deduplicate retried instructions.
Deployment contains no data migration, stock posting or inferred branch prices.
The product CSV importer still writes supplied selling prices to central defaults;
branch-specific sale prices must be configured separately. Its default unit cost
also values imported opening stock, and must not be replaced by a selling price.

Company acquisition/average/serial costs and HQ internal transfer agreements are
separate. Branch selling price edits never update productCosts, stock ledger
values, stock quantities, existing HQ agreements or company accounting balances.

POS, quotations, offline payloads and posted sale snapshots preserve null VAT.
Mixed carts apply only the rates actually provided. Documents mark unprovided
lines and explain that no VAT was added, without declaring a zero-rate treatment.
Existing numeric rates and historical snapshots are unchanged; a later tax change
invalidates stale queued price snapshots for review. New catalogue CSV prices also
retain unprovided VAT when the VAT column is blank. No deployment migration fills
or clears VAT.

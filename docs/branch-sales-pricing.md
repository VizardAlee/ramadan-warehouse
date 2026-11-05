# Branch selling prices

Products → Branch prices lets authorized price staff choose an active branch and
review retail and wholesale overrides. POS → Store-wide price opens the same
editor for the current branch. No stock location or inventory posting is needed
to configure pricing. Blank means inherit that level's central default; clearing
both restores central pricing. A missing central wholesale default leaves that
level unavailable unless an administrator explicitly approves branch wholesale.

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

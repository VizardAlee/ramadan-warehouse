# Custom operating roles

In Administration → Roles & permissions, create a role and choose an operating role starting point. Review the selected permissions before saving. Saving a role does not assign users or change existing staff access. Assign it separately through Users, retaining the staff member's intended branch assignments.

| Custom role | Built-in scope | Selected duties |
| --- | --- | --- |
| Salesperson | sales_cashier | Product and stock reads, branch sales reads, own device shift, sale order creation |
| Cashier | sales_cashier | Product and stock reads, branch sales reads, own device shift, payment acceptance against an existing order |
| Branch Stock Manager | branch_manager | Product and stock reads, counts, branch request read/create/edit/submit, branch transfer reads/receipt and discrepancy reporting |

The permission definitions are in `src/lib/permissions/operating-roles.ts`. A base profile supplies location scope, not its full built-in authority. These starting points omit optional credit, refunds, finance, adjustments, request approvals, final payment confirmation and stock release. The branch stock role cannot create or approve outgoing transfers.

A salesperson creates an order in their shift. A cashier at the same assigned branch opens their own shift and accepts payment against that order. The order retains its creator and payment acceptor. Final payment confirmation and stock release continue through the existing separately authorised workflow. Assigning both sales roles permits the same user to perform both duties; there is no universal different-person prohibition.

Branch stock staff submit replenishment requests and receive incoming transfers. Their incoming receipts remain visible in Action required even though they cannot create outgoing transfers. Transfer creation links and direct creation routes respect selected custom permissions, while existing directly assigned managers retain their established workflow.

## HQ configuration

Custom roles do not designate HQ or move warehouse staff. A read of the existing production configuration on 2026-11-01 found no `headOfficeBranchId` and no designated head-office branch. Do not infer a designation from a location's name, migrate users/history, or silently enforce new routing. An administrator can edit the intended branch under Stores & Head Office, designate it as Head Office and choose its optional supply warehouse. Neither field is selected automatically. The selected warehouse is suggested when fulfilling an approved request only if it has exactly one active stock location; otherwise the operator chooses a stock area. This does not prohibit other authorized sources, migrate history or change staff assignments. Strict HQ-only enforcement is not enabled.

## Validation and activation

Use only the `demo-ramadan-warehouse` emulators for fictional sales, stock and users. The operating-role tests cover client/server permission parity, omitted privileges, branch scope, multi-role unions, double submission, retry and cancellation. The callable tests exercise separate shifts and creator/payment actor evidence, combined-role sales, stock requests and receipts, and denied actions.

Publication and live role creation are distinct steps. Verify the exact published commit and deployment before declaring the changes live. Create each role through `saveOrganizationRole` in the authenticated admin workspace, inspect its saved permissions, and verify zero assigned users. If a role with that name already exists, inspect it rather than replacing it blindly. Do not weaken App Check or bypass authorization to complete activation.

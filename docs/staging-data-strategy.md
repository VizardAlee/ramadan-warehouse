# Staging data strategy

Staging starts with synthetic data only. It must not receive a copy of client production records, credentials, personal information, or attachments.

The baseline dataset is one sample organization; a central warehouse; Kaduna, Kano, and optionally Abuja branches; system, warehouse, logistics, branch, finance, and auditor users; quantity-, serial-, and lot-tracked products; controlled available, transit, damaged, returned, quarantine, and write-off locations; and synthetic opening balances. Workflow examples should include an approved request, request-linked and direct transfers, a transfer in transit, an open discrepancy, and an estimated-to-reconciled cost workflow.

Emulator seed and staging initialization are separate. `seed:emulator` is destructive only inside a `demo-*` emulator project. Any future staging initializer must require all of: the literal `staging` environment, an explicit non-demo project ID matching the `staging` alias, an empty/new-organization precondition, a typed confirmation containing that project ID, and an idempotency marker. It must create a new namespaced sample organization and refuse overwrite or update. No staging initializer is executed by local acceptance.

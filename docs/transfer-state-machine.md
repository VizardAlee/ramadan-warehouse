# Transfer state machine

`functions/src/transfers/transfer-state-machine.ts` is the canonical transition catalogue. Each edge declares permission, named preconditions, inventory/reservation effects, events, notifications, and terminality. Callables still enforce transaction-specific quantities and maker-checker controls; they must not write a status absent from this catalogue.

The principal path is `draft → submitted → under_review/approved → partially_reserved/reserved → picking → partially_picked/picked → packing → ready_for_dispatch → partially_dispatched/dispatched → partially_received/received/disputed → closed`. Change requests return submitted work to `changes_requested`; cancellation is terminal only before dispatch. A partially dispatched cancellation preserves the dispatched workflow and cancels only the remainder.

Inventory movement occurs only at dispatch, receipt, and approved discrepancy disposition. Reservation projection changes only at reserve, release, dispatch consumption, and remainder cancellation. Invalid edges fail as `INVALID_STATE_TRANSITION`; all declared and undeclared pairs are unit-tested.

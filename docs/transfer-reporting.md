# Transfer reporting

Callable reports cover register, goods in transit, request fulfilment, branch supply, costs, discrepancies, and performance. Filters are assignment-scoped and capped at 100 with document-ID cursors. UI CSV includes the loaded server-filtered page.

Cost fields are stripped without `transfers.cost.read`. High-volume aggregates and scheduled exports remain future hardening; browsers never scan unbounded collections.

# Request reporting

`generateBranchRequestReport` provides paginated register, item, pending, approval-performance, approved-unfulfilled, and product-demand views. Queries are organization scoped and branch scoped for branch roles. The request UI exports the currently loaded filtered rows using CSV escaping; browsers never scan an unlimited request collection.

Implemented filters include status, priority, branch, product, and report type at the callable layer. The indexes manifest covers current list queues, branch scope, item product reporting, events, versions, approvals, and comments. High-volume maintained aggregates and full cross-dimensional filtering remain later hardening.

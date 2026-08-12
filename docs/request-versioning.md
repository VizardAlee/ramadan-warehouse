# Request versioning

`branchRequestVersions/{requestId}__v{version}` is created atomically on every submission or resubmission. It contains the submitted header, immutable item snapshots, submitter, timestamp, and correlation ID. Draft edits do not create formal versions.

Approvals reference the evaluated version. Every transition validates `expectedVersion`; an approval for an older version is rejected. Request events preserve changes-requested reasons and submission/resubmission history, allowing auditors to reconstruct what was reviewed without mutating old snapshots.

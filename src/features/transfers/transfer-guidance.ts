export function isTransferSelfApprovalBlocked(
  status: string,
  createdBy: string,
  currentUserId: string,
) {
  return (
    ["submitted", "under_review"].includes(status) &&
    createdBy === currentUserId
  );
}

export function transferNextStepCopy(
  status: string,
  selfApprovalBlocked = false,
) {
  if (selfApprovalBlocked) {
    return "You created this transfer. Another authorized administrator or warehouse manager must approve it.";
  }
  if (status === "draft")
    return "Review the route and items, then submit this transfer for approval.";
  if (["submitted", "under_review"].includes(status))
    return "This transfer is waiting for review and approval.";
  if (["approved", "partially_reserved"].includes(status))
    return "Reserve the approved stock so warehouse preparation can begin.";
  if (
    [
      "reserved",
      "picking",
      "picked",
      "packing",
      "packed",
      "ready_for_dispatch",
    ].includes(status)
  )
    return "The warehouse should prepare and dispatch the approved stock.";
  if (
    ["partially_dispatched", "dispatched", "partially_received"].includes(
      status,
    )
  )
    return "The destination store should confirm what was received.";
  if (["received", "cost_reconciliation"].includes(status))
    return "Validate the completed movement and close the transfer.";
  if (status === "closed") return "This transfer is complete and closed.";
  if (status === "cancelled")
    return "This transfer was cancelled; no further movement is expected.";
  return "Review the transfer status and available actions below.";
}

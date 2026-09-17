export function isTransferSelfApprovalBlocked(
  status: string,
  createdBy: string,
  currentUserId: string,
  canApproveOwnWork = false,
) {
  return (
    ["submitted", "under_review"].includes(status) &&
    createdBy === currentUserId &&
    !canApproveOwnWork
  );
}

export function transferNextStepCopy(
  status: string,
  selfApprovalBlocked = false,
) {
  if (selfApprovalBlocked) {
    return "Your current role requires another authorized manager or administrator to approve this transfer.";
  }
  if (status === "draft")
    return "Review the route and items, then submit this transfer for approval.";
  if (["submitted", "under_review"].includes(status))
    return "This transfer is waiting for review and approval.";
  if (["approved", "partially_reserved"].includes(status))
    return "Reserve the approved stock so warehouse preparation can begin.";
  if (status === "reserved")
    return "Reservation is complete. Start picking, then record the goods physically collected from the warehouse.";
  if (["picking", "partially_picked"].includes(status))
    return "Record the reserved goods physically collected from the warehouse.";
  if (status === "picked")
    return "Picking is recorded. Pack and seal the goods for their destination.";
  if (["packing", "partially_packed"].includes(status))
    return "Finish packing and seal the package for dispatch.";
  if (status === "packed")
    return "Packing is complete. Seal the package before dispatch.";
  if (status === "ready_for_dispatch")
    return "The package is sealed and ready. Enter delivery details and confirm when it physically leaves the warehouse.";
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

export type SimpleTransferStatus =
  | "requested"
  | "awaiting_receipt"
  | "partially_received"
  | "problem"
  | "completed"
  | "cancelled";

export function simpleTransferActionCopy({
  status,
  sourceName,
  destinationName,
  canAct,
}: {
  status: SimpleTransferStatus;
  sourceName: string;
  destinationName: string;
  canAct: boolean;
}) {
  if (status === "requested")
    return canAct
      ? "Confirm stock and approve"
      : `Waiting for ${sourceName} to confirm stock`;
  if (["awaiting_receipt", "partially_received"].includes(status))
    return canAct
      ? "Confirm goods received"
      : `Waiting for ${destinationName} to confirm receipt`;
  if (status === "problem")
    return canAct
      ? "Review the reported problem"
      : `Waiting for ${sourceName} to resolve the problem`;
  if (status === "completed") return "View completed transfer";
  return "View cancelled transfer";
}

export function simpleTransferProgress(status: SimpleTransferStatus) {
  if (status === "completed") return 3;
  if (["awaiting_receipt", "partially_received", "problem"].includes(status))
    return 2;
  return ["requested", "cancelled"].includes(status) ? 1 : 0;
}

export interface RequestedLine {
  readonly id: string;
  readonly requestedQuantity: number;
}
export interface DecisionLine {
  readonly requestItemId: string;
  readonly approvedQuantity: number;
  readonly rejectedQuantity: number;
}
export function summarizeRequestDecision(
  requested: readonly RequestedLine[],
  decisions: readonly DecisionLine[],
) {
  if (requested.length !== decisions.length)
    throw new Error("Every requested item requires a complete decision.");
  const byId = new Map(
    decisions.map((decision) => [decision.requestItemId, decision]),
  );
  if (byId.size !== decisions.length)
    throw new Error("Decision items must be unique.");
  let totalRequestedQuantity = 0;
  let totalApprovedQuantity = 0;
  let totalRejectedQuantity = 0;
  for (const item of requested) {
    const decision = byId.get(item.id);
    if (
      !decision ||
      !Number.isSafeInteger(decision.approvedQuantity) ||
      !Number.isSafeInteger(decision.rejectedQuantity) ||
      decision.approvedQuantity < 0 ||
      decision.rejectedQuantity < 0 ||
      decision.approvedQuantity + decision.rejectedQuantity !==
        item.requestedQuantity
    )
      throw new Error(
        "Approved and rejected quantities must account for every requested unit.",
      );
    totalRequestedQuantity += item.requestedQuantity;
    totalApprovedQuantity += decision.approvedQuantity;
    totalRejectedQuantity += decision.rejectedQuantity;
  }
  return {
    totalRequestedQuantity,
    totalApprovedQuantity,
    totalRejectedQuantity,
    status:
      totalApprovedQuantity === 0
        ? ("rejected" as const)
        : totalRejectedQuantity === 0
          ? ("approved" as const)
          : ("partially_approved" as const),
  };
}

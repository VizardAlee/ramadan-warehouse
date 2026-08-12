import { db } from "../admin.js";
import type { ReconciliationRecord, TransferReconciliationCheck } from "../transfers/validate-transfer-invariants.js";

const number = (record: ReconciliationRecord, field: string) => Number(record[field] ?? 0);

export function evaluateOperationsReconciliation(
  requests: readonly ReconciliationRecord[],
  transferItems: readonly ReconciliationRecord[],
): TransferReconciliationCheck[] {
  return requests.map((request) => {
    const linkedReceived = transferItems
      .filter((item) => item.sourceRequestId === request.id)
      .reduce((total, item) => total + number(item, "receivedQuantity"), 0);
    const actual = number(request, "totalFulfilledQuantity");
    return {
      code: "REQUEST_FULFILMENT_MATCH",
      status: linkedReceived === actual ? "pass" : "fail",
      message: `Request ${request.id} fulfilment matches acceptable confirmed transfer receipts.`,
      expected: linkedReceived,
      actual,
    };
  });
}

export async function reconcileOrganizationRequests(organizationId: string) {
  const [requests, items] = await Promise.all([
    db.collection("branchRequests").where("organizationId", "==", organizationId).where("status", "in", ["approved", "partially_fulfilled", "fulfilled"]).limit(200).get(),
    db.collection("transferItems").where("organizationId", "==", organizationId).limit(500).get(),
  ]);
  return evaluateOperationsReconciliation(
    requests.docs.map((item) => ({ id: item.id, ...item.data() })),
    items.docs.map((item) => ({ id: item.id, ...item.data() })),
  );
}

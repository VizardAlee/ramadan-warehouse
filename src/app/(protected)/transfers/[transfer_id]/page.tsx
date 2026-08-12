"use client";
import { useParams } from "next/navigation";
import { TransferDetail } from "@/features/transfers/transfer-detail";
import { TransferList } from "@/features/transfers/transfer-list";
const views = new Set([
  "review",
  "reservations",
  "picking",
  "packing",
  "dispatch",
  "in-transit",
  "incoming",
  "discrepancies",
  "costs",
  "cost-approvals",
  "cost-reconciliation",
  "closed",
]);
export default function TransferRoutePage() {
  const { transfer_id: transferId } = useParams<{ transfer_id: string }>();
  return views.has(transferId) ? (
    <TransferList view={transferId} />
  ) : (
    <TransferDetail transferId={transferId} />
  );
}

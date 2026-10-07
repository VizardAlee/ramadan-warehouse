export const pipelineStages = {
  Review: ["draft", "submitted", "under_review", "changes_requested", "requested"],
  Preparation: ["approved", "partially_reserved", "reserved", "picking", "partially_picked", "picked", "packing", "packed", "ready_for_dispatch"],
  "In transit": ["partially_dispatched", "dispatched"],
  "Receiving & issues": ["awaiting_receipt", "problem", "partially_received", "received", "disputed", "cost_reconciliation"],
};
export interface DashboardWorkspace {
  asOf: string;
  fromDate: string;
  toDate: string;
  summary: { requests: number | null; transfers: number | null; products: number | null; discrepancies: number | null };
  pipeline: Array<{ label: string; value: number }>;
  sales: null | { saleCount: number; grossAmountMinor: number; amountPaidMinor: number; creditAmountMinor: number };
  trend: Array<{ date: string; label: string; value: number; count: number }>;
  paymentMix: Array<{ label: string; value: number; color: string }>;
}

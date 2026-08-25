export type PosPaymentMethod = "cash" | "card" | "bank_transfer";

export interface PosProduct {
  id: string;
  sku: string;
  name: string;
  unitOfMeasure: string;
  trackingType: "quantity";
  unitPriceMinor: number;
  basePriceMinor: number;
  vatRateBasisPoints: number;
  priceVersion: number;
  priceSource: "central" | "branch";
  availableQuantity: number;
}

export interface PosShift {
  id: string;
  deviceId: string;
  deviceName: string;
  status: "open";
  openingCashMinor: number;
  cashSalesMinor: number;
  nonCashSalesMinor: number;
  grossSalesMinor: number;
  saleCount: number;
}

export interface PosWorkspace {
  branch: { id: string; name: string; code: string };
  location: { id: string; name: string };
  products: PosProduct[];
  openShift: PosShift | null;
  refreshedAt: string;
}

export interface PosCartLine {
  product: PosProduct;
  quantity: number;
}

export interface PosSalePayload {
  branchId: string;
  shiftId: string;
  deviceId: string;
  recordedAt: string;
  offline: boolean;
  provisionalReceiptReference?: string;
  lines: Array<{
    productId: string;
    quantity: number;
    priceVersion?: number;
    unitPriceMinor?: number;
    vatRateBasisPoints?: number;
  }>;
  payments: Array<{
    method: PosPaymentMethod;
    amountMinor: number;
    reference?: string;
  }>;
  notes?: string;
  idempotencyKey: string;
}

export interface QueuedPosSale {
  id: string;
  userId: string;
  branchId: string;
  provisionalReceiptReference: string;
  payload: PosSalePayload;
  grossAmountMinor: number;
  createdAt: string;
  status: "queued" | "needs_review";
  lastError?: string;
}

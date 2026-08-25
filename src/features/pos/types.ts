export type PosPaymentMethod = "cash" | "card" | "bank_transfer" | "exchange_credit";
export type PosCheckoutMethod = PosPaymentMethod | "customer_credit";

export interface PosCustomer {
  id: string;
  customerNumber: string;
  name: string;
  phone: string | null;
  creditLimitMinor: number;
  outstandingBalanceMinor: number;
  availableCreditMinor: number;
}
export interface PosSalesCredit {
  id: string;
  creditNumber: string;
  remainingAmountMinor: number;
  returnId: string;
}

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
  creditSalesMinor: number;
  saleCount: number;
}

export interface PosWorkspace {
  branch: { id: string; name: string; code: string };
  location: { id: string; name: string };
  products: PosProduct[];
  customers: PosCustomer[];
  salesCredits: PosSalesCredit[];
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
  customerId?: string;
  creditAmountMinor?: number;
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

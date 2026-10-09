export type PosPaymentMethod = "cash" | "card" | "bank_transfer" | "exchange_credit";
export type PosCheckoutMethod = PosPaymentMethod | "customer_credit" | "split";

export interface SplitPaymentDraft {
  id: string;
  method: "cash" | "card" | "bank_transfer";
  amount: string;
  reference: string;
  bankAccountId: string;
}

export interface PosCustomer {
  arrangements?: import("@/types/domain").CustomerArrangement[];
  id: string;
  customerNumber: string;
  name: string;
  phone: string | null;
  pricingTier?: "retail" | "wholesale";
  creditStatus: "pending" | "approved" | "suspended" | "rejected";
  creditLimitMinor: number;
  outstandingBalanceMinor: number;
  availableCreditMinor: number;
}
export interface PosSalesCredit {
  customerId?: string | null;
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
  trackingType: "quantity" | "serial";
  unitPriceMinor: number;
  basePriceMinor: number;
  vatRateBasisPoints: number;
  priceVersion: number;
  priceSource: "central" | "branch" | "wholesale";
  wholesalePriceMinor?: number | null;
  centralPriceVersion?: number;
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

export interface PosPendingOrder {
  id: string;
  orderNumber: string;
  status: "order_received" | "payment_accepted";
  customerId: string | null;
  grossAmountMinor: number;
  totalQuantity: number;
  itemCount: number;
  paymentMethods: string[];
  recordedAt: string;
  createdAt: string | null;
  paymentAcceptedAt: string | null;
}

export interface PosWorkspace {
  branch: { id: string; name: string; code: string };
  location: { id: string; name: string };
  products: PosProduct[];
  customers: PosCustomer[];
  salesCredits: PosSalesCredit[];
  bankAccounts: Array<{
    id: string;
    bankName: string;
    accountName: string;
    accountNumberLast4: string;
    ledgerAccountCode: string;
  }>;
  pendingOrders: PosPendingOrder[];
  openShift: PosShift | null;
  refreshedAt: string;
}

export interface PosCartLine {
  serialNumbers?: string[];
  product: PosProduct;
  quantity: number;
  priceTier?: "retail" | "wholesale";
  sellingPriceMinor?: number;
  priceOverrideReason?: string;
}

export interface HeldPosSale {
  creditDueDate?: string;
  customerAccountId?: string;
  id: string;
  userId: string;
  branchId: string;
  lines: Array<{
    productId: string;
    serialNumbers?: string[];
    quantity: number;
    catalogUnitPriceMinor?: number;
    priceTier?: "retail" | "wholesale";
    sellingPriceMinor?: number;
    priceOverrideReason?: string;
  }>;
  customerId?: string;
  paymentMethod: PosCheckoutMethod;
  paymentReference?: string;
  bankAccountId?: string;
  discountAmount: string;
  discountReason: string;
  creditPaidAmount: string;
  creditIntent?: "credit" | "part";
  creditUpfrontMethod: "cash" | "card" | "bank_transfer";
  splitPayments?: SplitPaymentDraft[];
  splitAllowCredit?: boolean;
  grossAmountMinor: number;
  totalQuantity: number;
  createdAt: string;
  updatedAt: string;
}

export interface PosSalePayload {
  creditDueDate?: string;
  customerAccountId?: string;
  branchId: string;
  shiftId: string;
  deviceId: string;
  recordedAt: string;
  offline: boolean;
  provisionalReceiptReference?: string;
  lines: Array<{
    productId: string;
    serialNumbers?: string[];
    quantity: number;
    priceVersion?: number;
    priceTier?: "retail" | "wholesale";
    unitPriceMinor?: number;
    vatRateBasisPoints?: number;
    sellingPriceMinor?: number;
    priceOverrideReason?: string;
  }>;
  payments: Array<{
    method: PosPaymentMethod;
    amountMinor: number;
    reference?: string;
    bankAccountId?: string;
  }>;
  customerId?: string;
  creditAmountMinor?: number;
  discountAmountMinor?: number;
  discountReason?: string;
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

export interface SaleDocument {
  collections?: Array<{
    evidenceIds?: string[];
    id: string; referenceNumber?: string; waybillNumber?: string; collector: string; collectedAt: string | null;
    releasedBy: string; releasedByName?: string; notes?: string | null; totalQuantity: number;
    lines: Array<{ saleItemId?: string; productName: string; quantity: number; serialNumbers?: string[]; sku?: string; unitOfMeasure?: string }>;
  }>;
  official: boolean;
  organization: {
    legalName: string;
    tradingName: string | null;
    registrationNumber: string | null;
    address: string | null;
    contactEmail: string | null;
    phoneNumbers: string[];
  };
  branch: {
    id: string;
    name: string;
    code: string;
    address: string | null;
    state: string | null;
    contactPhone: string | null;
  };
  sale: {
    id: string;
    saleNumber: string;
    invoiceNumber: string;
    receiptNumber: string;
    paymentStatus: string;
    collectionStatus?: string;
    customerNumber: string | null;
    customerName: string | null;
    customerPhone: string | null;
    customerEmail: string | null;
    customerAddress: string | null;
    customerTaxId: string | null;
    netAmountMinor: number;
    subtotalAmountMinor: number;
    discountAmountMinor: number;
    discountReason: string | null;
    vatAmountMinor: number;
    grossAmountMinor: number;
    amountPaidMinor: number;
    creditAmountMinor: number;
    currency: "NGN";
    recordedAt: string | null;
    postedAt: string | null;
  };
  items: Array<{
    id: string;
    sku: string;
    productName: string;
    unitOfMeasure: string;
    quantity: number;
    trackingType?: "quantity" | "serial";
    serialNumbers?: string[];
    collectedSerialNumbers?: string[];
    cancelledSerialNumbers?: string[];
    collectedQuantity?: number;
    cancelledQuantity?: number;
    unitPriceMinor: number;
    subtotalAmountMinor: number;
    discountAmountMinor: number;
    vatRateBasisPoints: number;
    netAmountMinor: number;
    vatAmountMinor: number;
    grossAmountMinor: number;
  }>;
  payments: Array<{
    id: string;
    method: string;
    amountMinor: number;
    reference: string | null;
    status: string;
  }>;
}

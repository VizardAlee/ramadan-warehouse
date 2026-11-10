// Compatibility: headOfficeBranchId/headOfficeBranchName identify the supplying branch;
// branchId/branchName identify the buying branch, including on legacy HQ invoices.
export interface InternalTradeAgreement {
  version: 1;
  headOfficeBranchId: string;
  headOfficeBranchName?: string;
  pricingStatus: "required" | "priced";
  pricesByLineId: Record<string, number>;
  pricedBy?: string;
  pricedAt?: string;
}
export interface InternalTradeInvoiceLine {
  id: string; productId: string; productName: string; sku: string; trackingType: string;
  lotId?: string; unitPriceMinor: number; receivedQuantity: number; returnedQuantity: number;
  serialItemIds: string[]; returnedSerialItemIds: string[]; serialNumbers?:Record<string,string>;
  damagedQuantity?:number; pendingDamagedQuantity?:number; chargedDamagedQuantity?:number; waivedDamagedQuantity?:number; damagedSerialItemIds?:string[];
}
export interface InternalTradeInvoice {
  id: string; transferId: string; number: string; organizationId: string;
  branchId: string; branchName: string; headOfficeBranchId: string; headOfficeBranchName?:string;
  sourceLocationId: string; destinationLocationId: string; sourceWarehouseId?: string; sourceBranchId?: string;
  totalMinor: number; paidMinor: number; returnedMinor: number; balanceMinor: number; version: number;
  currency: "NGN"; lines: InternalTradeInvoiceLine[]; createdAt: string; updatedAt: string;
}
export interface InternalTradeBalance {
  organizationId: string; branchId: string; branchName?: string; headOfficeBranchId: string; headOfficeBranchName?:string;
  invoicedMinor: number; paidMinor: number; returnedMinor: number; balanceMinor: number; version: number;
}
export interface InternalTradeCapabilities {
  canPrice: boolean; canReadTrading: boolean; canRecordPayment: boolean; canReturn: boolean; canReviewDamage:boolean;
}
export interface InternalTradeEntry {
  id:string; invoiceId:string; kind:"invoice"|"payment"|"return"|"damage_hold"|"damage_charge"|"damage_waiver"; amountMinor:number; signedAmountMinor:number;
  createdAt:string; effectiveAt?:string; reference?:string; actorUserId:string;
}
export interface InternalTradeWorkspace extends InternalTradeCapabilities {
  invoices: InternalTradeInvoice[];
  entries: InternalTradeEntry[];
  nextEntriesCursor: string | null;
  balances: InternalTradeBalance[];
  branches: {id: string; name: string}[];
  accounts: {id: string; name: string; branchId: string | null}[];
  nextCursor: string | null;
}

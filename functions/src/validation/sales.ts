import { z } from "zod";

const saleSerialNumbers = z.array(z.string().trim().min(1).max(160)).max(50).optional();

const id = z.string().trim().min(1).max(128);
const money = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const positiveMoney = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const salesPriceInput = z.object({
  productId: id,
  basePriceMinor: positiveMoney,
  wholesalePriceMinor: positiveMoney.nullable().optional(),
  vatRateBasisPoints: z.number().int().min(0).max(10_000),
  active: z.boolean().default(true),
  idempotencyKey: z.string().uuid(),
});

export const branchSalesPriceInput = z.object({
  branchId: id,
  productId: id,
  sellingPriceMinor: positiveMoney,
  active: z.boolean().default(true),
  reason: z.string().trim().min(3).max(500).optional(),
  idempotencyKey: z.string().uuid(),
});

export const posWorkspaceInput = z.object({
  branchId: id,
  limit: z.number().int().min(1).max(500).default(200),
});

export const saleDocumentInput = z.object({
  saleId: id.refine(value => !value.includes("/") && value !== "." && value !== ".."),
  collectionCursorId: id.refine(value => !value.includes("/") && value !== "." && value !== "..").optional(),
  collectionLimit: z.union([z.literal(25), z.literal(50), z.literal(100)]).default(25),
});

export const listCollectionsInput = z.object({
  action: z.literal("list_collections"),
  branchId: id,
  limit: z.number().int().min(1).max(100).default(25),
  cursor: id.optional(),
});

export const salesReportInput = z.object({
  reportType: z.literal("sales_register").default("sales_register"),
  creditOnly: z.boolean().default(false),
  includeSummary: z.boolean().default(true),
  branchId: id.optional(),
  fromDate: z.string().date().optional(),
  toDate: z.string().date().optional(),
  cursor: z.object({
    recordedAt: z.string().datetime(),
    saleId: id,
  }).optional(),
  limit: z.number().int().min(1).max(500).default(200),
}).superRefine((value, context) => {
  if (value.fromDate && value.toDate && value.fromDate > value.toDate)
    context.addIssue({
      code: "custom",
      path: ["toDate"],
      message: "The report end date cannot be before its start date.",
    });
});

export const saveCustomerInput = z
  .object({
    customerId: id.optional(),
    name: z.string().trim().min(2).max(160),
    phone: z.string().trim().regex(/^0\d{10}$/, "Use an 11-digit Nigerian number beginning with 0.").optional(),
    email: z.string().trim().email().max(254).optional(),
    address: z.string().trim().max(500).optional(),
    taxId: z.string().trim().max(80).optional(),
    pricingTier: z.enum(["retail", "wholesale"]).optional(),
    arrangement: z.object({ id: z.string().uuid(), name: z.string().trim().min(2).max(80), active: z.boolean(), reason: z.string().trim().min(5).max(500) }).optional(),
    active: z.boolean().default(true),
    idempotencyKey: z.string().uuid(),
  })
  .superRefine((value, context) => {
    if (!value.phone && !value.email)
      context.addIssue({
        code: "custom",
        path: ["phone"],
        message: "Provide a phone number or email address.",
      });
  });

export const decideCustomerCreditInput = z.object({
  customerId: id,
  decision: z.enum(["approve", "suspend", "reject"]),
  creditLimitMinor: money.default(0),
  reason: z.string().trim().min(3).max(500),
  idempotencyKey: z.string().uuid(),
});

export const customerPaymentInput = z.object({
  customerId: id,
  branchId: id,
  method: z.enum(["cash", "card", "bank_transfer"]),
  bankAccountId: id.optional(),
  amountMinor: positiveMoney,
  purpose: z.enum(["repayment", "advance", "advance_refund"]).default("repayment"),
  source: z.enum(["receipt", "advance_balance"]).default("receipt"),
  invoiceAllocations: z.array(z.object({ saleId: id, amountMinor: positiveMoney })).min(1).max(50).optional(),
  allocations: z.array(z.object({ accountId: z.union([z.literal("general"), z.string().uuid()]), amountMinor: positiveMoney })).min(1).max(21).optional(),
  reference: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().uuid(),
}).superRefine((value, context) => {
  if (value.invoiceAllocations && (new Set(value.invoiceAllocations.map((item) => item.saleId)).size !== value.invoiceAllocations.length || value.invoiceAllocations.reduce((sum, item) => sum + item.amountMinor, 0) > value.amountMinor))
    context.addIssue({ code: "custom", path: ["invoiceAllocations"], message: "Use each invoice once without exceeding the payment total." });
  if ((value.purpose === "advance" && (value.source !== "receipt" || value.invoiceAllocations)) || (value.source === "advance_balance" && value.bankAccountId))
    context.addIssue({ code: "custom", path: ["source"], message: "Advance applications are not new cash or bank receipts." });
  if (value.purpose === "advance_refund") {
    if (value.source !== "receipt" || value.invoiceAllocations)
      context.addIssue({ code: "custom", path: ["source"], message: "An advance refund pays unused funds back; it cannot repay an invoice." });
    if (!value.notes || value.notes.length < 5)
      context.addIssue({ code: "custom", path: ["notes"], message: "Explain why this unused advance is being refunded." });
    if (value.method !== "cash" && (!value.bankAccountId || !value.reference || value.reference.length < 3))
      context.addIssue({ code: "custom", path: ["reference"], message: "Select the paying company account and provide the actual refund reference." });
    if (value.method === "cash" && value.bankAccountId)
      context.addIssue({ code: "custom", path: ["bankAccountId"], message: "A cash refund cannot debit a bank account." });
  }
  if (value.allocations && (new Set(value.allocations.map((item) => item.accountId)).size !== value.allocations.length || value.allocations.reduce((sum, item) => sum + item.amountMinor, 0) !== value.amountMinor))
    context.addIssue({ code: "custom", path: ["allocations"], message: "Use each account once and allocate the exact payment total." });
});

export const customerHistoryInput = z.object({
  view: z.enum(["activity", "receivables", "statement"]).default("activity"),
  includeSummary: z.boolean().default(true),
  customerId: id,
  customerAccountId: id.optional(),
  branchId: id.optional(),
  fromDate: z.string().date().optional(),
  toDate: z.string().date().optional(),
  limit: z.number().int().min(1).max(100).default(50),
  cursor: z.object({
    sale: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional(),
    return: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional(),
    account: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional(),
  }).optional(),
}).superRefine((value, context) => {
  if (value.fromDate && value.toDate && value.fromDate > value.toDate)
    context.addIssue({ code: "custom", path: ["toDate"], message: "The end date cannot be before the start date." });
});

export const openPosShiftInput = z.object({
  branchId: id,
  deviceId: id,
  deviceName: z.string().trim().min(2).max(120),
  openingCashMinor: money,
  idempotencyKey: z.string().uuid(),
});

export const closePosShiftInput = z.object({
  shiftId: id,
  closingCashMinor: money,
  notes: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().uuid(),
});

export const salePaymentMethods = [
  "cash",
  "card",
  "bank_transfer",
  "exchange_credit",
  "customer_advance",
] as const;

export const saleReturnWorkspaceInput = z.object({
  branchId: id,
  receiptNumber: z.string().trim().min(6).max(160),
});
export const listSaleReturnsInput = z.object({
  branchId: id,
  status: z.enum(["submitted", "approved"]).default("submitted"),
  limit: z.number().int().min(1).max(100).default(25),
  cursor: id.optional(),
});

export const createSaleReturnInput = z.object({
  kind: z.enum(["goods_return", "reservation_cancellation", "service_credit"]).default("goods_return"),
  branchId: id,
  saleId: id,
  lines: z.array(z.object({
    saleItemId: id,
    quantity: z.number().int().positive().max(100_000),
    serialNumbers: saleSerialNumbers,
    condition: z.enum(["restockable", "non_restockable"]),
  })).min(0).max(50),
  providerCredits: z.array(z.object({ saleItemId: id, amountMinor: positiveMoney })).min(1).max(50).optional(),
  resolution: z.enum(["cash", "card", "bank_transfer", "customer_account", "exchange_credit", "split"]),
  refundAmountMinor: positiveMoney.optional(),
  refundMethod: z.enum(["cash", "card", "bank_transfer", "exchange_credit"]).optional(),
  refundShiftId: id.optional(),
  bankAccountId: id.optional(),
  reason: z.string().trim().min(5).max(500),
  idempotencyKey: z.string().uuid(),
}).superRefine((value, context) => {
  if (!value.lines.length && !(value.kind === "service_credit" && value.providerCredits?.length)) context.addIssue({ code: "custom", path: ["lines"], message: "Select at least one charge to credit." });
  if (value.kind !== "service_credit" && value.providerCredits) context.addIssue({ code: "custom", path: ["providerCredits"], message: "Provider credits belong to a service commercial credit." });
  if (value.kind === "service_credit" && value.lines.some(line => line.condition !== "non_restockable" || line.serialNumbers?.length)) context.addIssue({ code: "custom", path: ["lines"], message: "Service credits never inspect, return or restock physical goods." });
  if (value.resolution === "split" ? !value.refundAmountMinor || !value.refundMethod : value.refundAmountMinor !== undefined || value.refundMethod !== undefined) context.addIssue({ code: "custom", path: ["resolution"], message: "Split resolution needs an explicit refund amount and method; the remainder reduces invoice debt." });
  const refundMethod = value.resolution === "split" ? value.refundMethod : value.resolution;
  if (new Set(value.providerCredits?.map(line => line.saleItemId)).size !== (value.providerCredits?.length ?? 0)) context.addIssue({ code: "custom", path: ["providerCredits"], message: "Use each provider obligation once." });
  if (new Set(value.lines.map((line) => line.saleItemId)).size !== value.lines.length)
    context.addIssue({ code: "custom", path: ["lines"], message: "Select each sale item only once." });
  if (["card", "bank_transfer"].includes(refundMethod ?? "") && !value.bankAccountId)
    context.addIssue({ code: "custom", path: ["bankAccountId"], message: "Select the company account funding this refund." });
  if (refundMethod === "cash" && !value.refundShiftId)
    context.addIssue({
      code: "custom",
      path: ["refundShiftId"],
      message: "Select the open POS shift funding this cash refund.",
    });
});

export const approveSaleReturnInput = z.object({
  returnId: id,
  action: z.enum(["approve", "inspect", "refund_exchange_credit", "route_aftersales", "dispose_held", "receive_supplier_replacement"]).default("approve"),
  replacement: z.object({
    handoverId: id.refine(value => !value.includes("/")),
    quantity: z.number().int().min(1).max(100000),
    serialNumber: z.string().trim().min(1).max(160).optional(),
    supplierReference: z.string().trim().min(3).max(160),
    reason: z.string().trim().min(5).max(1000),
    confirmedResellable: z.literal(true),
  }).optional(),
  disposition: z.object({
    caseId: id.refine(value => !value.includes("/")),
    outcome: z.enum(["restock", "scrap", "supplier_handover"]),
    quantity: z.number().int().min(1).max(100000),
    reason: z.string().trim().min(5).max(1000),
    confirmedResellable: z.boolean().optional(),
    supplierId: id.refine(value => !value.includes("/")).optional(),
    handoverReference: z.string().trim().min(3).max(160).optional(),
  }).optional(),
  aftersales: z.object({
    returnItemId: id,
    serialNumber: z.string().trim().min(1).max(160).optional(),
    complaint: z.string().trim().min(5).max(1000),
    contactName: z.string().trim().min(2).max(160).optional(),
    contactPhone: z.string().trim().min(5).max(50).optional(),
  }).optional(),
  inspection: z.object({
    notes: z.string().trim().min(5).max(1000),
    lines: z.array(z.object({
      returnItemId: id,
      disposition: z.enum(["resellable", "damaged", "defective", "warranty", "repair", "scrap", "return_to_supplier"]),
    })).min(1).max(50),
  }).optional(),
  refund: z.object({
    amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    method: z.enum(["cash", "card", "bank_transfer"]),
    bankAccountId: id.optional(),
    shiftId: id.optional(),
    reason: z.string().trim().min(5).max(500),
  }).optional(),
  bankAccountId: id.optional(),
  notes: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().uuid(),
}).superRefine((value, context) => {
  if (value.action === "receive_supplier_replacement" && !value.replacement)
    context.addIssue({ code: "custom", path: ["replacement"], message: "Identify the supplier handover and inspect the replacement goods." });
  if (value.action === "dispose_held" && (!value.disposition || (value.disposition.outcome === "restock" && !value.disposition.confirmedResellable) || (value.disposition.outcome === "supplier_handover" && (!value.disposition.supplierId || !value.disposition.handoverReference))))
    context.addIssue({ code: "custom", path: ["disposition"], message: "Select the held goods, confirm safe restocking or identify the supplier handover." });
  if (value.action === "route_aftersales" && !value.aftersales)
    context.addIssue({ code: "custom", path: ["aftersales"], message: "Select the inspected return item and describe the service request." });
  if (value.action === "inspect" && !value.inspection)
    context.addIssue({ code: "custom", path: ["inspection"], message: "Record each item's inspection result." });
  if (value.action === "refund_exchange_credit" && (!value.refund || (value.refund.method === "cash" ? !value.refund.shiftId : !value.refund.bankAccountId)))
    context.addIssue({ code: "custom", path: ["refund"], message: "Enter the refund and its funding account or open till." });
});

export const commitSaleInput = z.object({
  // Absence preserves the method used by existing queued and received orders.
  calculationVersion: z.literal(2).optional(),
  branchId: id,
  shiftId: id,
  deviceId: id,
  recordedAt: z.string().datetime(),
  offline: z.boolean().default(false),
  provisionalReceiptReference: z.string().trim().min(8).max(160).optional(),
  lines: z
    .array(
      z.object({
        productId: id,
        itemKind: z.enum(["goods", "service"]).optional(),
        includedParts: z.array(z.object({ productId: id, quantity: z.number().int().positive().max(100_000), serialNumbers: saleSerialNumbers })).min(1).max(10).optional(),
        providerFunds: z.object({ supplierId: id, amountMinor: positiveMoney }).optional(),
        aftersalesCaseId: id.optional(),
        serialNumbers: saleSerialNumbers,
        priceTier: z.enum(["retail", "wholesale"]).optional(),
        quantity: z.number().int().positive().max(100_000),
        priceVersion: z.number().int().positive().optional(),
        unitPriceMinor: money.optional(),
        vatRateBasisPoints: z.number().int().min(0).max(10_000).optional(),
        sellingPriceMinor: positiveMoney.optional(),
        priceOverrideReason: z.string().trim().min(3).max(300).optional(),
      }),
    )
    .min(1)
    .max(50)
    .superRefine((lines, context) => {
      const ids = lines.map((line) => line.productId);
      if (new Set(ids).size !== ids.length)
        context.addIssue({
          code: "custom",
          message: "Each product may appear only once in a sale.",
        });
      lines.forEach((line, index) => {
        if ((line.sellingPriceMinor === undefined) !== (line.priceOverrideReason === undefined))
          context.addIssue({
            code: "custom",
            path: [index, "priceOverrideReason"],
            message: "A sale-specific price requires an audit reason.",
          });
      });
    }),
  payments: z
    .array(
      z.object({
        method: z.enum(salePaymentMethods),
        amountMinor: positiveMoney,
        reference: z.string().trim().max(120).optional(),
        bankAccountId: id.optional(),
      }),
    )
    .min(0)
    .max(5),
  customerId: id.optional(),
  creditAmountMinor: money.default(0),
  creditDueDate: z.iso.date().optional(),
  customerAccountId: z.union([z.literal("general"), z.string().uuid()]).optional(),
  discountAmountMinor: money.default(0),
  discountReason: z.string().trim().min(3).max(300).optional(),
  notes: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().uuid(),
}).superRefine((value, context) => {
  const mixed = value.lines.some(line => line.itemKind === "service" || line.includedParts || line.providerFunds || line.aftersalesCaseId);
  if (mixed && (value.offline || value.calculationVersion !== 2)) context.addIssue({ code: "custom", path: ["offline"], message: "Mixed billing requires online confirmation with current calculations." });
  if (value.lines.reduce((sum, line) => sum + (line.includedParts?.length ?? 0), 0) > 50) context.addIssue({ code: "custom", path: ["lines"], message: "Use at most 50 included physical parts per bill." });
  value.lines.forEach((line, index) => {
    if ((line.includedParts || line.providerFunds || line.aftersalesCaseId) && line.itemKind !== "service") context.addIssue({ code: "custom", path: ["lines", index], message: "Parts included in the fee, provider funds and linked cases belong to a service line." });
    if (line.aftersalesCaseId && (line.quantity !== 1 || line.sellingPriceMinor !== undefined || line.priceTier === "wholesale")) context.addIssue({ code: "custom", path: ["lines", index], message: "A linked confirmed case has one immutable charge; price overrides and wholesale are unavailable." });
    if (line.includedParts && new Set(line.includedParts.map(part => part.productId)).size !== line.includedParts.length) context.addIssue({ code: "custom", path: ["lines", index], message: "Each included part appears once per service." });
  });
  const advances = value.payments.filter(payment => payment.method === "customer_advance");
  if (advances.length && (value.offline || !value.customerId || advances.length > 1 || advances.some(payment => payment.bankAccountId || payment.reference)))
    context.addIssue({ code: "custom", path: ["payments"], message: "Use one customer advance component, online, for a named customer. Advances are not new bank receipts." });
  if (value.customerAccountId && !value.customerId)
    context.addIssue({ code: "custom", path: ["customerAccountId"], message: "Select a named customer before choosing an account arrangement." });
  if (value.discountAmountMinor > 0 && !value.discountReason)
    context.addIssue({
      code: "custom",
      path: ["discountReason"],
      message: "Enter a reason for the discount.",
    });
  if (value.creditAmountMinor > 0 && !value.customerId)
    context.addIssue({
      code: "custom",
      path: ["customerId"],
      message: "Select an approved customer for credit.",
    });
  if (value.creditAmountMinor > 0 && value.offline)
    context.addIssue({
      code: "custom",
      path: ["offline"],
      message: "Credit sales require a live online authorization check.",
    });
  if (value.offline && value.payments.some((payment) => payment.method === "exchange_credit"))
    context.addIssue({
      code: "custom",
      path: ["payments"],
      message: "Exchange credit requires a live online balance check.",
    });
  for (const [index, payment] of value.payments.entries())
    if (payment.method === "exchange_credit" && !payment.reference)
      context.addIssue({
        code: "custom",
        path: ["payments", index, "reference"],
        message: "Select an exchange credit.",
      });
  const creditReferences = value.payments.filter((payment) => payment.method === "exchange_credit").map((payment) => payment.reference);
  if (new Set(creditReferences).size !== creditReferences.length)
    context.addIssue({ code: "custom", path: ["payments"], message: "An exchange credit may be used only once per sale." });
  if (value.creditAmountMinor === 0 && value.payments.length === 0 && !value.lines.some(line => line.aftersalesCaseId))
    context.addIssue({
      code: "custom",
      path: ["payments"],
      message: "A paid sale requires at least one payment.",
    });
});

export const acceptPosSaleOrderPaymentInput = z.object({
  orderId: id,
  shiftId: id,
  deviceId: id,
  idempotencyKey: z.string().uuid(),
});

export const confirmPosSaleOrderInput = z.object({
  orderId: id,
  deferCollection: z.boolean().default(false),
  idempotencyKey: z.string().uuid(),
});

export const collectSaleInput = z.object({
  action: z.literal("collect"),
  saleId: id,
  lines: z.array(z.object({ saleItemId: id, quantity: z.number().int().positive().max(1000000), serialNumbers: saleSerialNumbers })).min(1).max(50),
  collector: z.string().trim().min(2).max(120),
  evidenceIds: z.array(id).max(5).optional().refine(value => !value || new Set(value).size === value.length, "Choose each collection photo once."),
  notes: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().uuid(),
}).refine((value) => new Set(value.lines.map((line) => line.saleItemId)).size === value.lines.length, "Select each sale item only once.");

export const rejectPosSaleOrderInput = z.object({
  orderId: id,
  reason: z.string().trim().min(5).max(500),
  idempotencyKey: z.string().uuid(),
});

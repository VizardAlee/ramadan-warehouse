import { z } from "zod";

const id = z.string().trim().min(1).max(180);
const key = z.string().uuid();
const qty = z.number().int().positive().max(1_000_000_000);
const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const priority = z.enum(["low", "normal", "high", "urgent", "critical"]);
const line = z.object({
  productId: id,
  quantity: qty,
  sourceRequestItemId: id.optional(),
  serialItemIds: z.array(id).max(500).default([]),
  lotAllocations: z
    .array(z.object({ lotId: id, quantity: qty }))
    .max(100)
    .default([]),
});
const header = z.object({
  originWarehouseId: id,
  originLocationId: id,
  destinationBranchId: id,
  destinationLocationId: id,
  purpose: text(5, 1000),
  priority,
  expectedDispatchDate: z.string().date().optional(),
  expectedDeliveryDate: z.string().date().optional(),
  items: z.array(line).min(1).max(100),
  idempotencyKey: key,
});
export const createTransferFromRequestInput = header.extend({
  sourceRequestId: id,
  sourceRequestVersion: z.number().int().positive(),
  sourceApprovalId: id,
});
export const createAdminTransferInput = header.extend({
  directTransferReason: text(5, 1000),
});
export const updateTransferDraftInput = header.extend({
  transferId: id,
  expectedVersion: z.number().int().nonnegative(),
});
export const transferActionInput = z.object({
  transferId: id,
  expectedVersion: z.number().int().nonnegative(),
  reason: z.string().trim().min(3).max(1000).optional(),
  idempotencyKey: key,
});
export const reserveTransferInput = transferActionInput.extend({
  lines: z
    .array(line.extend({ transferItemId: id }))
    .min(1)
    .max(100)
    .optional(),
});
export const releaseReservationInput = transferActionInput.extend({
  reservationIds: z.array(id).min(1).max(100).optional(),
});
export const pickedItemsInput = transferActionInput.extend({
  pickerNote: z.string().trim().max(1000).optional(),
  lines: z
    .array(
      z.object({
        transferItemId: id,
        quantity: qty,
        serialItemIds: z.array(id).max(500).default([]),
        lotAllocations: z
          .array(z.object({ lotId: id, quantity: qty }))
          .max(100)
          .default([]),
        varianceReason: z.string().trim().max(500).optional(),
      }),
    )
    .min(1)
    .max(100),
});
export const verifyPickInput = transferActionInput.extend({
  pickId: id,
  accepted: z.boolean(),
  note: z.string().trim().max(500).optional(),
});
export const packageInput = transferActionInput.extend({
  packageId: id.optional(),
  packageType: z.string().trim().max(100).optional(),
  weightKg: z.number().positive().max(100000).optional(),
  dimensions: z
    .object({
      lengthCm: z.number().positive(),
      widthCm: z.number().positive(),
      heightCm: z.number().positive(),
    })
    .optional(),
  sealNumber: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(1000).optional(),
  lines: z
    .array(
      z.object({
        transferItemId: id,
        quantity: qty,
        serialItemIds: z.array(id).max(500).default([]),
        lotAllocations: z
          .array(z.object({ lotId: id, quantity: qty }))
          .max(100)
          .default([]),
      }),
    )
    .min(1)
    .max(100),
});
export const packageActionInput = transferActionInput.extend({
  packageId: id,
  note: z.string().trim().max(500).optional(),
});
export const dispatchInput = transferActionInput.extend({
  dispatchId: id.optional(),
  packageIds: z.array(id).min(1).max(100),
  vehicleId: id.optional(),
  vehicleRegistration: z.string().trim().max(40).optional(),
  driverName: text(2, 160),
  driverPhoneNumber: z.string().trim().max(40).optional(),
  transportCompany: z.string().trim().max(160).optional(),
  waybillNumber: z.string().trim().max(100).optional(),
  expectedArrivalAt: z.string().datetime().optional(),
  verifiedBy: id.optional(),
});
export const receiptInput = transferActionInput.extend({
  dispatchId: id,
  receiptId: id.optional(),
  deliveryCondition: z.enum([
    "good",
    "partially_damaged",
    "severely_damaged",
    "rejected",
  ]),
  receiverNote: z.string().trim().max(1000).optional(),
  signatureReference: z.string().trim().max(300).optional(),
  photoReferences: z.array(z.string().trim().max(300)).max(10).default([]),
  lines: z
    .array(
      z.object({
        transferItemId: id,
        receivedQuantity: z.number().int().nonnegative(),
        damagedQuantity: z.number().int().nonnegative(),
        missingQuantity: z.number().int().nonnegative(),
        rejectedQuantity: z.number().int().nonnegative().default(0),
        serialItemIds: z.array(id).max(500).default([]),
        damagedSerialItemIds: z.array(id).max(500).default([]),
        lotAllocations: z
          .array(z.object({
            lotId: id,
            quantity: qty,
            disposition: z.enum(["received", "damaged"]).default("received"),
          }))
          .max(100)
          .default([]),
        note: z.string().trim().max(500).optional(),
      }),
    )
    .min(1)
    .max(100),
});
export const discrepancyInput = transferActionInput.extend({
  dispatchId: id,
  receiptId: id.optional(),
  type: z.enum([
    "missing_quantity",
    "damaged_quantity",
    "wrong_product",
    "serial_mismatch",
    "lot_mismatch",
    "excess_quantity",
    "package_damage",
    "delivery_refused",
    "lost_in_transit",
    "other",
  ]),
  description: text(3, 1500),
  lines: z
    .array(
      z.object({
        transferItemId: id,
        quantity: qty,
        serialItemIds: z.array(id).max(500).default([]),
        lotId: id.optional(),
      }),
    )
    .min(1)
    .max(100),
});
export const resolveDiscrepancyInput = transferActionInput.extend({
  discrepancyId: id,
  resolutionType: z.enum([
    "delivered_later",
    "replacement_transfer",
    "returned_to_warehouse",
    "accepted_as_damaged",
    "written_off",
    "carrier_liability",
    "branch_error",
    "warehouse_error",
    "no_variance_found",
  ]),
  resolutionLocationId: id.optional(),
  note: text(3, 1500),
});
export const costInput = z.object({
  transferId: id,
  costId: id.optional(),
  category: z.enum([
    "transportation",
    "loading",
    "offloading",
    "packaging",
    "fuel",
    "driver_allowance",
    "insurance",
    "security",
    "third_party_logistics",
    "temporary_storage",
    "damage",
    "loss",
    "miscellaneous",
  ]),
  description: text(3, 500),
  estimatedAmountMinor: money,
  vendorName: z.string().trim().max(160).optional(),
  vendorReference: z.string().trim().max(160).optional(),
  idempotencyKey: key,
});
export const costActionInput = z.object({
  transferId: id,
  costId: id,
  amountMinor: money.optional(),
  reason: z.string().trim().min(3).max(500).optional(),
  idempotencyKey: key,
});
export const transferQueryInput = z.object({
  transferId: id.optional(),
  status: z.string().trim().max(50).optional(),
  branchId: id.optional(),
  warehouseId: id.optional(),
  sourceType: z.enum(["branch_request", "admin_allocation"]).optional(),
  cursor: id.optional(),
  limit: z.number().int().min(1).max(100).default(50),
  reportType: z
    .enum([
      "register",
      "goods_in_transit",
      "fulfilment",
      "cost",
      "discrepancy",
      "branch_supply",
      "dispatch_performance",
    ])
    .default("register"),
});
export const logisticsResourceInput = z.object({
  id: id.optional(),
  resourceType: z.enum(["vehicle", "driver", "vendor"]),
  name: text(2, 160),
  registrationNumber: z.string().trim().max(60).optional(),
  phoneNumber: z.string().trim().max(40).optional(),
  licenseReference: z.string().trim().max(100).optional(),
  vehicleType: z.string().trim().max(100).optional(),
  capacityKg: z.number().positive().max(1_000_000).optional(),
  vendorId: id.optional(),
  active: z.boolean().default(true),
  idempotencyKey: key,
});

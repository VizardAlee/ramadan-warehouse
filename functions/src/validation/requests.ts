import { z } from "zod";

const id = z.string().trim().min(1).max(160);
const idempotencyKey = z.string().uuid();
const optionalText = (max: number) => z.string().trim().max(max).optional();
const quantity = z.number().int().positive().max(1_000_000_000);
const requestType = z.enum([
  "stock_replenishment",
  "customer_installation",
  "project_allocation",
  "emergency_replacement",
  "warranty_replacement",
  "inter_branch_support",
  "internal_use",
  "other",
]);
const priority = z.enum(["low", "normal", "high", "urgent", "critical"]);
export const requestItemInput = z.object({
  id: id.optional(),
  productId: id,
  requestedQuantity: quantity,
  requesterNote: optionalText(500),
});
const requestHeader = z.object({
  branchId: id,
  requestType,
  priority,
  purpose: z.string().trim().min(5).max(1000),
  requiredDate: z.string().date().optional(),
  projectReference: optionalText(160),
  customerReference: optionalText(160),
  warrantyReference: optionalText(160),
  attachmentMetadata: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(180),
        contentType: z.string().trim().min(1).max(120),
        size: z.number().int().nonnegative().max(20_000_000),
      }),
    )
    .max(10)
    .default([]),
});
export const createBranchRequestInput = requestHeader.extend({
  items: z.array(requestItemInput).max(100).default([]),
  idempotencyKey,
});
export const updateBranchRequestInput = requestHeader.extend({
  requestId: id,
  expectedVersion: z.number().int().nonnegative(),
  items: z.array(requestItemInput).max(100),
  idempotencyKey,
});
export const requestActionInput = z.object({
  requestId: id,
  expectedVersion: z.number().int().nonnegative(),
  reason: z.string().trim().min(3).max(1000).optional(),
  idempotencyKey,
});
export const requestDecisionInput = requestActionInput.extend({
  decisions: z
    .array(
      z.object({
        requestItemId: id,
        approvedQuantity: z.number().int().nonnegative().max(1_000_000_000),
        rejectedQuantity: z.number().int().nonnegative().max(1_000_000_000),
        note: optionalText(500),
      }),
    )
    .min(1)
    .max(100),
});
export const requestCommentInput = z.object({
  requestId: id,
  comment: z.string().trim().min(1).max(2000),
  visibility: z.enum(["branch", "internal"]),
  idempotencyKey,
});
export const requestQueryInput = z.object({
  requestId: id.optional(),
  branchId: id.optional(),
  productId: id.optional(),
  status: z
    .enum([
      "draft",
      "submitted",
      "under_review",
      "changes_requested",
      "approved",
      "partially_approved",
      "rejected",
      "partially_fulfilled",
      "fulfilled",
      "cancelled",
      "closed",
    ])
    .optional(),
  priority: priority.optional(),
  requestType: requestType.optional(),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
  cursor: id.optional(),
  limit: z.number().int().min(1).max(100).default(50),
  includeCosts: z.boolean().default(false),
  reportType: z
    .enum([
      "register",
      "items",
      "pending",
      "approval_performance",
      "approved_unfulfilled",
      "product_demand",
    ])
    .default("register"),
});

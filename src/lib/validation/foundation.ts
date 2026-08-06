import { z } from "zod";
import { inventoryLocationTypes, permissionIds, roleIds } from "@/types/domain";

const idSchema = z.string().trim().min(1).max(128);
const codeSchema = z.string().trim().min(2).max(24).regex(/^[A-Z0-9_-]+$/);
const entityStatusSchema = z.enum(["active", "inactive"]);

const baseEntitySchema = z.object({
  organizationId: idSchema,
  name: z.string().trim().min(2).max(120),
  code: codeSchema,
  status: entityStatusSchema.default("active"),
});

export const organizationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: codeSchema,
  defaultCurrency: z.literal("NGN").default("NGN"),
  timezone: z.string().trim().min(1).default("Africa/Lagos"),
  status: entityStatusSchema.default("active"),
});

export const branchSchema = baseEntitySchema.extend({ address: z.string().trim().max(500).optional() });
export const warehouseSchema = baseEntitySchema.extend({ address: z.string().trim().max(500).optional() });

export const inventoryLocationSchema = baseEntitySchema
  .extend({
    type: z.enum(inventoryLocationTypes),
    warehouseId: idSchema.optional(),
    branchId: idSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.type === "warehouse" && !value.warehouseId) {
      context.addIssue({ code: "custom", path: ["warehouseId"], message: "Warehouse locations require a warehouse" });
    }
    if (value.type === "branch" && !value.branchId) {
      context.addIssue({ code: "custom", path: ["branchId"], message: "Branch locations require a branch" });
    }
  });

export const userProfileSchema = z.object({
  organizationId: idSchema,
  email: z.string().trim().email().max(254),
  displayName: z.string().trim().min(2).max(120),
  status: entityStatusSchema.default("active"),
  roleIds: z.array(z.enum(roleIds)).min(1),
  permissionOverrides: z.array(z.enum(permissionIds)).default([]),
  branchIds: z.array(idSchema).default([]),
  warehouseIds: z.array(idSchema).default([]),
});

export type OrganizationInput = z.infer<typeof organizationSchema>;
export type BranchInput = z.infer<typeof branchSchema>;
export type WarehouseInput = z.infer<typeof warehouseSchema>;
export type InventoryLocationInput = z.infer<typeof inventoryLocationSchema>;
export type UserProfileInput = z.infer<typeof userProfileSchema>;

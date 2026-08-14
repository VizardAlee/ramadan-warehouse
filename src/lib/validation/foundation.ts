import { z } from "zod";
import { inventoryLocationTypes, roleIds } from "@/types/domain";

const idSchema = z.string().trim().min(1).max(128);
const codeSchema = z.string().trim().min(2).max(24).regex(/^[A-Z0-9_-]+$/);
const entityStatusSchema = z.enum(["active", "inactive"]);
const optionalText = (maximum: number) => z.string().trim().max(maximum).optional();

export const organizationSchema = z.object({
  legalName: z.string().trim().min(2).max(160), tradingName: optionalText(160), code: codeSchema, registrationNumber: optionalText(80),
  contactEmail: z.string().trim().email().max(254).optional(), phoneNumbers: z.array(z.string().trim().min(7).max(24)).max(5).default([]), address: optionalText(500),
  defaultCurrency: z.literal("NGN").default("NGN"), timezone: z.string().trim().min(1).default("Africa/Lagos"), status: entityStatusSchema.default("active"),
});
const baseEntitySchema = z.object({ name: z.string().trim().min(2).max(120), code: codeSchema, status: entityStatusSchema.default("active") });
export const branchSchema = baseEntitySchema.extend({ address: optionalText(500), state: optionalText(80), contactEmail: z.string().trim().email().optional(), contactPhone: optionalText(24), managerUserId: idSchema.optional() });
export const warehouseSchema = baseEntitySchema.extend({ address: optionalText(500), state: optionalText(80), managerIds: z.array(idSchema).default([]) });
export const inventoryLocationSchema = baseEntitySchema.extend({ type: z.enum(inventoryLocationTypes), warehouseId: idSchema.optional(), branchId: idSchema.optional(), systemManaged: z.boolean().default(false) }).superRefine((value, context) => {
  if (value.type === "warehouse" && !value.warehouseId) context.addIssue({ code: "custom", path: ["warehouseId"], message: "Warehouse locations require a warehouse" });
  if (value.type === "branch" && !value.branchId) context.addIssue({ code: "custom", path: ["branchId"], message: "Branch locations require a branch" });
  if (value.warehouseId && value.branchId) context.addIssue({ code: "custom", path: ["branchId"], message: "A location cannot belong to both a branch and warehouse" });
});
export const userProfileSchema = z.object({
  email: z.string().trim().email().max(254), displayName: z.string().trim().min(2).max(120), phoneNumber: z.string().trim().min(7).max(24).optional(), employeeReference: optionalText(80),
  status: z.enum(["active", "inactive", "suspended"]).default("active"), roleId: z.enum(roleIds), roleIds: z.array(z.enum(roleIds)).min(1).max(roleIds.length).optional(), branchIds: z.array(idSchema).max(100).default([]), warehouseIds: z.array(idSchema).max(100).default([]),
});
export type OrganizationInput = z.infer<typeof organizationSchema>;
export type BranchInput = z.infer<typeof branchSchema>;
export type WarehouseInput = z.infer<typeof warehouseSchema>;
export type InventoryLocationInput = z.infer<typeof inventoryLocationSchema>;
export type UserProfileInput = z.infer<typeof userProfileSchema>;

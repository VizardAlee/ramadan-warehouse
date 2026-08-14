import { z } from "zod";
import { roles } from "../auth/authorize.js";
import { isSupportedNigerianMobile } from "../utils/nigerian-phone.js";

const id = z.string().trim().min(1).max(128);
const code = z.string().trim().toUpperCase().min(2).max(24).regex(/^[A-Z0-9_-]+$/);
const text = (max: number) => z.string().trim().max(max).optional();
const optionalEmail = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().email().max(254).optional(),
);
const optionalId = z.preprocess(
  (value) => value == null || (typeof value === "string" && value.trim() === "") ? undefined : value,
  id.optional(),
);
const userPhone = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z
    .string()
    .trim()
    .refine(isSupportedNigerianMobile, {
      message: "Use a Nigerian mobile number such as 07032545288",
    })
    .optional(),
);
export const organizationInput = z.object({ legalName: z.string().trim().min(2).max(160), tradingName: text(160), code, registrationNumber: text(80), contactEmail: optionalEmail, phoneNumbers: z.array(z.string().trim().min(7).max(24)).max(5).default([]), address: text(500), defaultCurrency: z.literal("NGN").default("NGN"), timezone: z.string().trim().min(1).default("Africa/Lagos") });
export const bootstrapInput = z.object({ organization: organizationInput, bootstrapSecret: z.string().min(16).max(512).optional() });
export const userInput = z.object({ email: z.string().trim().toLowerCase().email().max(254), displayName: z.string().trim().min(2).max(120), phoneNumber: userPhone, employeeReference: text(80), roleId: z.enum(roles), branchIds: z.array(id).max(100).default([]), warehouseIds: z.array(id).max(100).default([]), status: z.enum(["active", "inactive", "suspended"]).default("active"), idempotencyKey: z.string().uuid() });
export const updateUserInput = userInput.omit({ email: true, idempotencyKey: true }).partial().extend({ userId: id, reason: z.string().trim().min(3).max(500), idempotencyKey: z.string().uuid() });
export const revokeSessionsInput = z.object({ userId: id, reason: z.string().trim().min(3).max(500) });
const baseMaster = z.object({ id: optionalId, name: z.string().trim().min(2).max(120), code, status: z.enum(["active", "inactive"]).default("active"), address: text(500), state: text(80) });
export const branchInput = baseMaster.extend({ contactEmail: optionalEmail, contactPhone: text(24), managerUserId: optionalId, idempotencyKey: z.string().uuid() });
export const warehouseInput = baseMaster.extend({ managerIds: z.array(id).max(20).default([]), idempotencyKey: z.string().uuid() });
export const locationInput = baseMaster.omit({ address: true, state: true }).extend({ type: z.enum(["warehouse", "branch", "goods_in_transit", "damaged", "quarantined", "returned"]), warehouseId: id.optional(), branchId: id.optional(), systemManaged: z.boolean().default(false), idempotencyKey: z.string().uuid() }).superRefine((value, context) => {
  if (value.type === "warehouse" && !value.warehouseId) context.addIssue({ code: "custom", path: ["warehouseId"], message: "Warehouse is required" });
  if (value.type === "branch" && !value.branchId) context.addIssue({ code: "custom", path: ["branchId"], message: "Branch is required" });
  if (value.branchId && value.warehouseId) context.addIssue({ code: "custom", path: ["branchId"], message: "Choose one owner" });
});
export const updateOrganizationInput = organizationInput.partial().omit({ code: true }).extend({ status: z.enum(["active", "inactive"]).optional(), reason: z.string().trim().min(3).max(500) });

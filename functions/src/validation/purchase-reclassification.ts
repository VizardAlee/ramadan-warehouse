import { z } from "zod";
const id = z.string().trim().min(1).max(128).refine(value => !value.includes("/"));
const selection = {
  supplierInvoiceIds: z.array(id).length(3).refine(ids => new Set(ids).size === ids.length),
  lines: z.array(z.object({ supplierInvoiceItemId: id, externalSupplierId: id.optional(), sourceLocationId: id.optional() }).strict()
    .refine(line => Boolean(line.externalSupplierId) !== Boolean(line.sourceLocationId), "Choose exactly one actual external supplier or internal source location.")).length(6)
    .refine(lines => new Set(lines.map(line => line.supplierInvoiceItemId)).size === lines.length),
  confirmedZeroTransport: z.literal(true),
  confirmedSourceNotPreviouslyIssued: z.literal(true),
};
export const previewPurchaseReclassificationInput = z.object({command: z.literal("preview_reclassification"), ...selection}).strict();
export const executePurchaseReclassificationInput = z.object({command:z.literal("execute_reclassification"), ...selection,
  expectedEvidenceFingerprint:z.string().regex(/^[a-f0-9]{64}$/), idempotencyKey:z.string().uuid(), reason:z.string().trim().min(10).max(500),
}).strict();

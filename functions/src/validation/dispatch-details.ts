import { z } from "zod";

// Keep international phone numbers, free-form plates and people's names usable.
// Control characters have no place in a printed single-line dispatch detail.
const detail = (max: number) => z.string().trim().max(max).refine(value => !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127), "Use a single line without control characters.");
export const dispatchDetailsShape = {
  dispatcherPhone: detail(60).optional(),
  vehiclePlate: detail(40).optional(),
  deliveryRecipientName: detail(120).optional(),
};
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const updateDispatchDetailsInput = z.object({
  action: z.literal("update_dispatch_details"),
  saleId: id,
  collectionId: id,
  expectedVersion: z.number().int().nonnegative().safe(),
  ...dispatchDetailsShape,
  idempotencyKey: z.string().uuid(),
});

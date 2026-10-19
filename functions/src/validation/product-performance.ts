import { z } from "zod";
export const performanceId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const productPerformanceInput = z.object({
  branchId: performanceId.optional(), productId: performanceId.optional(),
  fromDate: z.iso.date(), toDate: z.iso.date(),
}).superRefine((input, context) => {
  const days = calendarDays(input.fromDate, input.toDate);
  if (days < 1 || days > 366) context.addIssue({ code: "custom", path: ["toDate"], message: "Choose an inclusive reporting period of 1–366 calendar days." });
});
export function calendarDays(from: string, to: string) { return Math.round((Date.parse(`${to}T00:00:00+01:00`) - Date.parse(`${from}T00:00:00+01:00`)) / 86_400_000) + 1; }

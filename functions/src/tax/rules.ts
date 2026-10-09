import { z } from "zod";

const date = z.string().date();
const safeMinor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
// Existing IDs encode human version labels; keep them usable without rewriting records.
export const taxRuleDocumentId = z.string().min(1).max(1500).refine(value => !value.includes("/") && value !== "." && value !== ".." && Buffer.byteLength(value, "utf8") <= 1500);
export const taxRuleDefinition = z.object({
  taxType: z.enum(["VAT", "CIT", "DEVELOPMENT_LEVY", "WHT", "STAMP_DUTY", "OTHER"]),
  scopeKey: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{1,63}$/),
  version: z.string().trim().min(1).max(64),
  title: z.string().trim().min(3).max(160),
  effectiveFrom: date,
  effectiveTo: date,
  calculation: z.literal("flat_rate"),
  basis: z.enum(["taxable_supplies", "taxable_profit", "assessable_profit", "withholding_base", "instrument_value", "reviewed_base"]),
  rateBasisPoints: z.number().int().min(0).max(10000),
  applicability: z.string().trim().min(10).max(2000),
  exemptions: z.string().trim().min(3).max(2000),
  source: z.string().url().max(1000).refine(value => new URL(value).protocol === "https:", "Use an HTTPS statutory source."),
  sourceReference: z.string().trim().min(3).max(500),
}).strict().superRefine((value, context) => {
  if (value.effectiveFrom > value.effectiveTo) context.addIssue({ code: "custom", path: ["effectiveTo"], message: "The rule end date must not precede its start date." });
});
export type TaxRuleDefinition = z.infer<typeof taxRuleDefinition>;
const mutation = { reason: z.string().trim().min(10).max(2000), idempotencyKey: z.string().uuid() };
export const taxRuleAdministrationInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("propose"), definition: taxRuleDefinition, ...mutation }).strict(),
  z.object({ action: z.literal("review"), ruleId: taxRuleDocumentId, decision: z.enum(["approved", "rejected"]), sourceVerified: z.boolean(), ...mutation }).strict(),
  z.object({ action: z.literal("preview"), ruleId: taxRuleDocumentId, transactionDate: date, baseMinor: safeMinor }).strict(),
]);

/** No statutory rates are embedded here. A caller must supply a reviewed base. */
export function calculateReviewedTax(rule: TaxRuleDefinition, transactionDate: string, baseMinor: number) {
  const parsed = taxRuleDefinition.parse(rule);
  date.parse(transactionDate); safeMinor.parse(baseMinor);
  if (transactionDate < parsed.effectiveFrom || transactionDate > parsed.effectiveTo) throw new Error("This rule is not effective on the selected date.");
  // BigInt avoids precision loss before rounding even for large safe minor units.
  const amount = (BigInt(baseMinor) * BigInt(parsed.rateBasisPoints) + 5000n) / 10000n;
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Tax exceeds safe minor-unit arithmetic.");
  return { baseMinor, taxMinor: Number(amount), ruleVersion: parsed.version, rateBasisPoints: parsed.rateBasisPoints,
    basis: parsed.basis, transactionDate, source: parsed.source, sourceReference: parsed.sourceReference };
}

export function periodsOverlap(a: Pick<TaxRuleDefinition, "effectiveFrom" | "effectiveTo">, b: Pick<TaxRuleDefinition, "effectiveFrom" | "effectiveTo">) {
  return a.effectiveFrom <= b.effectiveTo && b.effectiveFrom <= a.effectiveTo;
}

/** Coverage is not the same as a single rule merely overlapping a report. */
export function hasReviewedTaxCoverage(records: Array<Record<string, unknown>>, taxType: string, scopeKey: string, fromDate: string, toDate: string) {
  const rules = records.filter(record => record.status === "approved" && record.sourceVerified === true)
    .map(record => taxRuleDefinition.safeParse(Object.fromEntries(Object.keys(taxRuleDefinition.shape).map(key => [key, record[key]]))))
    .flatMap(parsed => parsed.success && parsed.data.taxType === taxType && parsed.data.scopeKey === scopeKey ? [parsed.data] : [])
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  const relevant = rules.filter(rule => rule.effectiveTo >= fromDate && rule.effectiveFrom <= toDate);
  if (relevant.some((rule, index) => index > 0 && periodsOverlap(relevant[index - 1]!, rule))) return false;
  let coveredThrough: string | undefined;
  for (const rule of relevant) {
    if (!coveredThrough) { if (rule.effectiveFrom > fromDate) return false; }
    else {
      const nextDate = new Date(`${coveredThrough}T00:00:00Z`); nextDate.setUTCDate(nextDate.getUTCDate() + 1);
      if (rule.effectiveFrom > nextDate.toISOString().slice(0, 10) || rule.effectiveFrom <= coveredThrough) return false;
    }
    coveredThrough = rule.effectiveTo;
    if (coveredThrough >= toDate) return true;
  }
  return false;
}

export function definitionFromRecord(record: Record<string, unknown>) {
  return taxRuleDefinition.parse(Object.fromEntries(Object.keys(taxRuleDefinition.shape).map(key => [key, record[key]])));
}

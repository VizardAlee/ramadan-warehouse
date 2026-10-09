import { assertBalancedJournal } from "../sales/calculations.js";

export function assertSafeJournal(lines: readonly { debitMinor: number; creditMinor: number }[]) {
  assertBalancedJournal(lines);
  for (const side of ["debitMinor", "creditMinor"] as const)
    if (!Number.isSafeInteger(lines.reduce((sum, line) => sum + line[side], 0)))
      throw new Error("Journal totals exceed safe minor-unit arithmetic.");
}

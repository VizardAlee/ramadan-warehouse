/** Display the first unmet existing prerequisite; this never changes action authority. */
export function firstBlocker(checks: ReadonlyArray<readonly [unknown, string]>): string | undefined {
  return checks.find(([blocked]) => Boolean(blocked))?.[1];
}

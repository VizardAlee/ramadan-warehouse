import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("desktop sidebar", () => {
  it("keeps the brand visible and navigation scrollable on short screens", () => {
    const shell = readFileSync(
      join(process.cwd(), "src/components/layout/app-shell.tsx"),
      "utf8",
    );

    expect(shell).toMatch(/aria-label="Desktop navigation"[\s\S]*?className="[^"]*min-h-0[^"]*flex-1[^"]*overflow-y-auto/);
    expect(shell).toMatch(/<aside className="[^"]*inset-y-0[^"]*flex-col overflow-hidden[^"]*xl:flex/);
    expect(shell).toMatch(/href="\/dashboard"[\s\S]*?className="[^"]*shrink-0/);
  });
});

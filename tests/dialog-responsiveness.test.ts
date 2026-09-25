import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("dialog responsiveness", () => {
  it("keeps dialog content reachable on narrow and short viewports", () => {
    const styles = readFileSync(
      join(process.cwd(), "src/app/globals.css"),
      "utf8",
    );

    expect(styles).toContain(".app-dialog-backdrop");
    expect(styles).toContain("overflow-y: auto");
    expect(styles).toContain(".app-dialog-panel");
    expect(styles).toContain("max-width: min(var(--dialog-max-width, 36rem), calc(100vw - 1rem))");
    expect(styles).toContain(".app-dialog-panel.max-w-lg { --dialog-max-width: 32rem; }");
    expect(styles).toContain("max-height: calc(100dvh - 1rem)");
    expect(styles).toContain("@media (max-height: 700px)");
    expect(styles).toMatch(
      /@media \(max-height: 700px\)[\s\S]*?align-items: flex-start/,
    );
    expect(styles).toMatch(
      /@media \(max-height: 700px\)[\s\S]*?margin-block: 0/,
    );
    expect(styles.match(/@keyframes app-view-enter \{([\s\S]*?)\}/)?.[1]).not.toContain("transform");
  });
});

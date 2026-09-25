// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppDialog } from "../src/components/ui/app-dialog";

describe("AppDialog", () => {
  it("renders outside the page layout so its positioning and width are not clipped", () => {
    render(
      <main>
        <AppDialog role="dialog" aria-label="Add customer">
          <div className="app-dialog-panel max-w-lg">Customer form</div>
        </AppDialog>
      </main>,
    );

    const dialog = screen.getByRole("dialog", { name: "Add customer" });
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog.querySelector(".app-dialog-panel")?.className).toContain("max-w-lg");
  });
});

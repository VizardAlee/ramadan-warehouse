// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppDialog } from "@/components/ui/app-dialog";
import { Button } from "@/components/ui/button";
import { useDialogFocus } from "@/components/ui/use-dialog-focus";
import { ActionGuidanceProvider } from "@/features/guidance/action-guidance";

afterEach(cleanup);

describe("POS price dialog keyboard guidance", () => {
  it("leaves Tab from enabled Save free to reach its disclosure, then wraps at that disclosure", async () => {
    function Fixture() {
      const ref = useDialogFocus<HTMLElement>(true);
      return <ActionGuidanceProvider pathname="/pos" profile={null}>
        <AppDialog role="dialog" aria-label="Store-wide selling price">
          <section ref={ref}>
            <button>Cancel</button>
            <Button>Save branch price</Button>
            <details><summary hidden>Hidden help</summary></details>
            <details><summary tabIndex={-1}>Programmatic help</summary></details>
          </section>
        </AppDialog>
      </ActionGuidanceProvider>;
    }
    render(<Fixture />);
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const save = screen.getByRole("button", { name: "Save branch price" });
    const summary = screen.getByText("Action requirements");
    save.focus();
    const tabFromSave = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    fireEvent(save, tabFromSave);
    expect(tabFromSave.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(save);
    // JSDOM does not perform the browser's default Tab traversal.
    summary.focus();
    fireEvent.keyDown(summary, { key: "Tab" });
    expect(document.activeElement).toBe(cancel);
    fireEvent.keyDown(cancel, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(summary);
    fireEvent.click(summary);
    expect((summary.parentElement as HTMLDetailsElement).open).toBe(true);
    expect(await screen.findByText(/Enter the real store price/)).toBeTruthy();
  });
});

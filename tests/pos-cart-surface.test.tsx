// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PosCartSurface } from "@/features/pos/cart-surface";
import { useDialogFocus } from "@/components/ui/use-dialog-focus";

afterEach(cleanup);

describe("POS cart overlay", () => {
  it("escapes the workspace stacking context and closes only on a backdrop click", () => {
    const close = vi.fn();
    render(<main style={{ opacity: 1, transform: "translateY(0)" }}>
      <PosCartSurface open onClose={close}>
        <aside role="dialog" aria-label="Current sale"><button>Receive order</button></aside>
      </PosCartSurface>
    </main>);
    const dialog = screen.getByRole("dialog", { name: "Current sale" });
    const overlay = dialog.parentElement!;
    expect(overlay.parentElement).toBe(document.body);
    fireEvent.click(screen.getByRole("button", { name: "Receive order" }));
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(overlay);
    expect(close).toHaveBeenCalledOnce();
  });

  it("keeps the closed desktop cart in the workspace", () => {
    const view = render(<main><PosCartSurface open={false} onClose={vi.fn()}>
      <aside data-testid="cart">Basket</aside>
    </PosCartSurface></main>);
    expect(screen.getByTestId("cart").parentElement).toBe(view.container.querySelector("main"));
    expect(document.querySelector(".app-dialog-backdrop")).toBeNull();
  });

  it("supports Escape and restores focus to the mobile opener", () => {
    function Fixture() {
      const [open, setOpen] = useState(false);
      const ref = useDialogFocus<HTMLElement>(open, () => setOpen(false));
      return <main><button onClick={() => setOpen(true)}>Open cart</button>
        <PosCartSurface open={open} onClose={() => setOpen(false)}>
          <aside ref={ref} role={open ? "dialog" : undefined}>
            <button>Payment and checkout</button><button onClick={() => setOpen(false)}>Close cart</button>
          </aside>
        </PosCartSurface>
      </main>;
    }
    render(<Fixture />);
    const opener = screen.getByRole("button", { name: "Open cart" });
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Payment and checkout" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});

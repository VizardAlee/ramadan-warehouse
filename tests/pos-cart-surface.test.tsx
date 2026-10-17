// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PosCartSurface } from "@/features/pos/cart-surface";

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
    const overlay = dialog.closest(".app-dialog-backdrop")!;
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
    expect(screen.getByTestId("cart").closest("main")).toBe(view.container.querySelector("main"));
    expect(document.querySelector(".app-dialog-backdrop")).toBeNull();
  });

  it("supports Escape and restores focus to the mobile opener", () => {
    function Fixture() {
      const [open, setOpen] = useState(false);
      return <main><button onClick={() => setOpen(true)}>Open cart</button>
        <PosCartSurface open={open} onClose={() => setOpen(false)}>
          <aside role={open ? "dialog" : undefined}>
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

  it("focuses an initially open cart and removes its host when unmounted", () => {
    const view = render(<PosCartSurface open onClose={vi.fn()}>
      <aside role="dialog"><button>Close initial cart</button></aside>
    </PosCartSurface>);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close initial cart" }));
    view.unmount();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector(".app-dialog-backdrop")).toBeNull();
  });

  it("hydrates the inline cart without a portal hydration mismatch", async () => {
    const errors = vi.fn();
    const element = <main><PosCartSurface open={false} onClose={vi.fn()}>
      <aside><button>Hydrated cart control</button></aside>
    </PosCartSurface></main>;
    const container = document.createElement("div");
    container.innerHTML = renderToString(element);
    document.body.appendChild(container);
    let root: Root | undefined;
    try {
      await act(async () => { root = hydrateRoot(container, element, { onRecoverableError: errors }); });
      expect(screen.getByRole("button", { name: "Hydrated cart control" }).closest("main")).toBe(container.querySelector("main"));
      expect(errors).not.toHaveBeenCalled();
    } finally {
      await act(async () => { root?.unmount(); });
      container.remove();
    }
  });
});

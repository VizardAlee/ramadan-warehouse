// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/features/theme/theme-provider";
import { ThemeSwitch } from "@/features/theme/theme-switch";
import { THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from "@/features/theme/theme";
let dark = true;
const listeners = new Set<() => void>();
beforeEach(() => { dark = true; listeners.clear(); localStorage.clear(); delete document.documentElement.dataset.theme; delete document.documentElement.dataset.themePreference; vi.stubGlobal("matchMedia", () => ({ get matches() { return dark; }, addEventListener: (_: string, fn: () => void) => listeners.add(fn), removeEventListener: (_: string, fn: () => void) => listeners.delete(fn) })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const boot = (storage: Pick<Storage, "getItem"> = localStorage) => new Function("document", "localStorage", "matchMedia", THEME_INIT_SCRIPT)(document, storage, window.matchMedia);
describe("appearance preference before paint and during use", () => {
  it("resolves first use from the system before React mounts", () => { boot(); expect(document.documentElement.dataset.theme).toBe("dark"); expect(document.documentElement.dataset.themePreference).toBe("system"); expect(document.documentElement.style.colorScheme).toBe("dark"); });
  it("uses a manual light choice despite a dark system", () => { localStorage.setItem(THEME_STORAGE_KEY, "light"); boot(); expect(document.documentElement.dataset.theme).toBe("light"); });
  it("treats an invalid saved choice as System and still works when storage is denied", () => { localStorage.setItem(THEME_STORAGE_KEY, "unexpected"); boot(); expect(document.documentElement.dataset.themePreference).toBe("system"); dark = false; boot({ getItem() { throw new Error("denied"); } }); expect(document.documentElement.dataset.theme).toBe("light"); });
  it("persists manual choices, ignores system changes until System is selected and restores across mounts", async () => {
    const view = render(<ThemeProvider><ThemeSwitch /></ThemeProvider>);
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
    fireEvent.change(screen.getByLabelText("Appearance"), { target: { value: "light" } });
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    act(() => { dark = true; listeners.forEach(fn => fn()); }); expect(document.documentElement.dataset.theme).toBe("light");
    view.unmount(); render(<ThemeProvider><ThemeSwitch /></ThemeProvider>);
    await waitFor(() => expect((screen.getByLabelText("Appearance") as HTMLSelectElement).value).toBe("light"));
    fireEvent.change(screen.getByLabelText("Appearance"), { target: { value: "system" } });
    expect(document.documentElement.dataset.theme).toBe("dark");
    act(() => { dark = false; listeners.forEach(fn => fn()); }); expect(document.documentElement.dataset.theme).toBe("light");
  });
  it("synchronizes another tab's preference without changing records", async () => {
    render(<ThemeProvider><ThemeSwitch /></ThemeProvider>); await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
    localStorage.setItem(THEME_STORAGE_KEY, "light"); act(() => window.dispatchEvent(new StorageEvent("storage", { key: THEME_STORAGE_KEY })));
    expect(document.documentElement.dataset.theme).toBe("light");
  });
  it("applies a manual choice even if saving it is blocked", async () => {
    render(<ThemeProvider><ThemeSwitch /></ThemeProvider>); await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
    fireEvent.change(screen.getByLabelText("Appearance"), { target: { value: "light" } }); expect(document.documentElement.dataset.theme).toBe("light");
  });
});

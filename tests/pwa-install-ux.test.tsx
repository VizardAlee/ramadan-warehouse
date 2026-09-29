// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PwaInstallBanner } from "@/features/pwa/pwa-install-banner";
import { PwaControls } from "@/features/pwa/pwa-controls";

const pwa = vi.hoisted(() => ({
  state: {
    installed: false,
    installAvailable: true,
    manualInstallPlatform: "desktop-browser",
    showManualInstructions: false,
    updateAvailable: false,
    install: vi.fn(async () => undefined),
    closeManualInstructions: vi.fn(),
    applyUpdate: vi.fn(),
  },
}));

vi.mock("@/features/pwa/pwa-provider", () => ({ usePwa: () => pwa.state }));

beforeEach(() => {
  window.localStorage.clear();
  pwa.state.installed = false;
  pwa.state.installAvailable = true;
  pwa.state.manualInstallPlatform = "desktop-browser";
  pwa.state.showManualInstructions = false;
  pwa.state.install.mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("PWA install invitation", () => {
  it("offers a visible install button after sign-in and installs from a user click", () => {
    render(<PwaInstallBanner />);
    act(() => vi.advanceTimersByTime(1600));
    expect(screen.getByText("Install AB Ramadan on this device")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Install app" }));
    expect(pwa.state.install).toHaveBeenCalledOnce();
    expect(screen.queryByText("Install AB Ramadan on this device")).toBeNull();
  });

  it("respects a dismissal while retaining the header install control", () => {
    const view = render(<PwaInstallBanner />);
    act(() => vi.advanceTimersByTime(1600));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss install suggestion" }));
    view.unmount();
    render(<><PwaInstallBanner /><PwaControls /></>);
    act(() => vi.advanceTimersByTime(1600));
    expect(screen.queryByText("Install AB Ramadan on this device")).toBeNull();
    expect(screen.getByRole("button", { name: "Install AB Ramadan app" })).toBeTruthy();
  });

  it("does not offer installation inside an installed app", () => {
    pwa.state.installed = true;
    pwa.state.installAvailable = false;
    render(<><PwaInstallBanner /><PwaControls /></>);
    act(() => vi.advanceTimersByTime(1600));
    expect(screen.queryByText("Install AB Ramadan on this device")).toBeNull();
    expect(screen.queryByRole("button", { name: "Install AB Ramadan app" })).toBeNull();
  });

  it.each([
    ["ios", "Install on iPhone or iPad", "Add to Home Screen"],
    ["android", "Install on Android", "Install app"],
    ["desktop-browser", "Install on this computer", "Install page as app"],
    ["mac-safari", "Install on Mac", "Add to Dock"],
  ])("guides %s users when native install is unavailable", (platform, title, instruction) => {
    pwa.state.manualInstallPlatform = platform;
    pwa.state.showManualInstructions = true;
    render(<PwaControls />);
    expect(screen.getByRole("heading", { name: title })).toBeTruthy();
    expect(screen.getByText(instruction)).toBeTruthy();
  });
});

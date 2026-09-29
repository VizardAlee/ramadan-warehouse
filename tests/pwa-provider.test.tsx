// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PwaProvider, usePwa } from "@/features/pwa/pwa-provider";

function InstallProbe() {
  const { installed, installAvailable, showManualInstructions, install } = usePwa();
  return <>
    <output>{installed ? "installed" : installAvailable ? "install available" : "unavailable"}</output>
    {showManualInstructions && <p>Manual instructions open</p>}
    <button type="button" onClick={() => void install()}>Install app</button>
  </>;
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PWA install provider", () => {
  it("opens the browser-native prompt only after an install-button click", async () => {
    const prompt = vi.fn(async () => undefined);
    render(<PwaProvider><InstallProbe /></PwaProvider>);
    const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt,
      userChoice: Promise.resolve({ outcome: "accepted", platform: "web" }),
    });
    act(() => { window.dispatchEvent(event); });
    expect(prompt).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Install app" }));
    await waitFor(() => expect(prompt).toHaveBeenCalledOnce());
    act(() => { window.dispatchEvent(new Event("appinstalled")); });
    expect(screen.getByText("installed")).toBeTruthy();
  });

  it("shows manual guidance when the browser offers no native prompt", () => {
    render(<PwaProvider><InstallProbe /></PwaProvider>);
    expect(screen.getByText("install available")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Install app" }));
    expect(screen.getByText("Manual instructions open")).toBeTruthy();
  });
});

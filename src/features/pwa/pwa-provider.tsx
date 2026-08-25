"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

interface PwaContextValue {
  installed: boolean;
  installAvailable: boolean;
  manualInstallPlatform: "ios" | "mac-safari" | null;
  showManualInstructions: boolean;
  updateAvailable: boolean;
  install(): Promise<void>;
  closeManualInstructions(): void;
  applyUpdate(): void;
}

const PwaContext = createContext<PwaContextValue | null>(null);

function isStandalone() {
  if (typeof window === "undefined") return false;
  const safariNavigator = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || safariNavigator.standalone === true;
}

function detectManualInstallPlatform(): "ios" | "mac-safari" | null {
  if (typeof window === "undefined") return null;
  const iosDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (iosDevice && /WebKit/.test(navigator.userAgent)) return "ios";
  const desktopSafari = /Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Edg/.test(navigator.userAgent) && /Macintosh/.test(navigator.userAgent);
  return desktopSafari ? "mac-safari" : null;
}

export function PwaProvider({ children }: { children: ReactNode }) {
  const [installed, setInstalled] = useState(isStandalone);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [manualPlatform, setManualPlatform] = useState<"ios" | "mac-safari" | null>(() => isStandalone() ? null : detectManualInstallPlatform());
  const [showManualInstructions, setShowManualInstructions] = useState(false);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    const captureInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const markInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
      setManualPlatform(null);
      setShowManualInstructions(false);
    };
    window.addEventListener("beforeinstallprompt", captureInstallPrompt);
    window.addEventListener("appinstalled", markInstalled);

    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).then((workerRegistration) => {
        setRegistration(workerRegistration);
        setUpdateAvailable(Boolean(workerRegistration.waiting));
        workerRegistration.addEventListener("updatefound", () => {
          const worker = workerRegistration.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) setUpdateAvailable(true);
          });
        });
      }).catch(() => {
        // The application remains usable online when service-worker registration is unavailable.
      });
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", captureInstallPrompt);
      window.removeEventListener("appinstalled", markInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (installPrompt) {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === "accepted") setInstallPrompt(null);
      return;
    }
    if (manualPlatform) setShowManualInstructions(true);
  }, [installPrompt, manualPlatform]);

  const applyUpdate = useCallback(() => {
    if (!registration?.waiting) return;
    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });
    registration.waiting.postMessage({ type: "SKIP_WAITING" });
  }, [registration]);

  const value = useMemo<PwaContextValue>(() => ({
    installed,
    installAvailable: Boolean(installPrompt) || Boolean(manualPlatform),
    manualInstallPlatform: manualPlatform,
    showManualInstructions,
    updateAvailable,
    install,
    closeManualInstructions: () => setShowManualInstructions(false),
    applyUpdate,
  }), [applyUpdate, install, installPrompt, installed, manualPlatform, showManualInstructions, updateAvailable]);

  return <PwaContext.Provider value={value}>{children}</PwaContext.Provider>;
}

export function usePwa() {
  const context = useContext(PwaContext);
  if (!context) throw new Error("usePwa must be used inside PwaProvider.");
  return context;
}

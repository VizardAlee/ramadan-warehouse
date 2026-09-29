"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

interface PwaContextValue {
  installed: boolean;
  installAvailable: boolean;
  manualInstallPlatform: "ios" | "mac-safari" | "android" | "desktop-browser" | null;
  showManualInstructions: boolean;
  updateAvailable: boolean;
  install(): Promise<void>;
  closeManualInstructions(): void;
  applyUpdate(): void;
}

const PwaContext = createContext<PwaContextValue | null>(null);
const subscribeStandalone = () => () => undefined;

function isStandalone() {
  if (typeof window === "undefined") return false;
  const safariNavigator = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || safariNavigator.standalone === true;
}

function detectManualInstallPlatform(): "ios" | "mac-safari" | "android" | "desktop-browser" | null {
  if (typeof window === "undefined") return null;
  const iosDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (iosDevice && /WebKit/.test(navigator.userAgent)) return "ios";
  const desktopSafari = /Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Edg/.test(navigator.userAgent) && /Macintosh/.test(navigator.userAgent);
  if (desktopSafari) return "mac-safari";
  if (/Android/.test(navigator.userAgent)) return "android";
  return "desktop-browser";
}

export function PwaProvider({ children }: { children: ReactNode }) {
  const standalone = useSyncExternalStore(subscribeStandalone, isStandalone, () => false);
  const [appInstalled, setAppInstalled] = useState(false);
  const installed = standalone || appInstalled;
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const manualPlatform = installed ? null : detectManualInstallPlatform();
  const [showManualInstructions, setShowManualInstructions] = useState(false);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    const captureInstallPrompt = (event: Event) => {
      event.preventDefault();
      if (isStandalone()) return;
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const markInstalled = () => {
      setAppInstalled(true);
      setInstallPrompt(null);
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
      try {
        await installPrompt.prompt();
        await installPrompt.userChoice;
      } catch {
        setShowManualInstructions(true);
      } finally {
        // A beforeinstallprompt event can only be used once, including after dismissal.
        setInstallPrompt(null);
      }
      return;
    }
    setShowManualInstructions(true);
  }, [installPrompt]);

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
    installAvailable: !installed,
    manualInstallPlatform: manualPlatform,
    showManualInstructions,
    updateAvailable,
    install,
    closeManualInstructions: () => setShowManualInstructions(false),
    applyUpdate,
  }), [applyUpdate, install, installed, manualPlatform, showManualInstructions, updateAvailable]);

  return <PwaContext.Provider value={value}>{children}</PwaContext.Provider>;
}

export function usePwa() {
  const context = useContext(PwaContext);
  if (!context) throw new Error("usePwa must be used inside PwaProvider.");
  return context;
}

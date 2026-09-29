"use client";

import { Download, RefreshCw, Share, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppDialog } from "@/components/ui/app-dialog";
import { useDialogFocus } from "@/components/ui/use-dialog-focus";
import { usePwa } from "@/features/pwa/pwa-provider";

export function PwaControls() {
  const {
    installAvailable,
    manualInstallPlatform,
    showManualInstructions,
    updateAvailable,
    install,
    closeManualInstructions,
    applyUpdate,
  } = usePwa();
  const instructionsRef = useDialogFocus<HTMLElement>(showManualInstructions, closeManualInstructions);

  return (
    <>
      {installAvailable && (
        <Button
          size="icon"
          variant="ghost"
          title="Install AB Ramadan app"
          aria-label="Install AB Ramadan app"
          onClick={() => void install()}
        >
          <Download className="size-4" />
        </Button>
      )}
      {updateAvailable && (
        <Button
          size="icon"
          variant="ghost"
          title="Update app"
          aria-label="Update ABR Warehouse app"
          onClick={applyUpdate}
        >
          <RefreshCw className="size-4" />
        </Button>
      )}
      {showManualInstructions && (
        <AppDialog
          className="app-dialog-backdrop-high"
          role="dialog"
          aria-modal="true"
          aria-labelledby="install-instructions-title"
        >
          <section ref={instructionsRef} className="app-dialog-panel safe-bottom max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="install-instructions-title" className="text-xl font-semibold">
                  {manualInstallPlatform === "mac-safari"
                    ? "Install on Mac"
                    : manualInstallPlatform === "ios"
                      ? "Install on iPhone or iPad"
                      : manualInstallPlatform === "android"
                        ? "Install on Android"
                        : "Install on this computer"}
                </h2>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  {manualInstallPlatform === "mac-safari"
                    ? "Safari can add AB Ramadan to your Dock."
                    : manualInstallPlatform === "ios"
                      ? "Use your browser’s Share menu to add AB Ramadan to your Home Screen."
                      : "Use your browser menu to install AB Ramadan as an app."}
                </p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Close install instructions"
                onClick={closeManualInstructions}
              >
                <X className="size-5" />
              </Button>
            </div>
            {manualInstallPlatform === "mac-safari" ? (
              <ol className="mt-5 space-y-4 text-sm">
                <li className="flex gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-emerald-50 font-semibold text-[var(--brand)]">
                    1
                  </span>
                  <span>
                    Open Safari&apos;s <strong>File</strong> menu.
                  </span>
                </li>
                <li className="flex gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-emerald-50 font-semibold text-[var(--brand)]">
                    2
                  </span>
                  <span>
                    Choose <strong>Add to Dock</strong>, then confirm.
                  </span>
                </li>
              </ol>
            ) : manualInstallPlatform === "ios" ? (
              <ol className="mt-5 space-y-4 text-sm">
                <li className="flex gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-emerald-50 font-semibold text-[var(--brand)]">
                    1
                  </span>
                  <span>
                    Tap the browser&apos;s{" "}
                    <strong className="inline-flex items-center gap-1">
                      Share <Share className="size-4" />
                    </strong>{" "}
                    button.
                  </span>
                </li>
                <li className="flex gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-emerald-50 font-semibold text-[var(--brand)]">
                    2
                  </span>
                  <span>
                    Choose <strong>Add to Home Screen</strong>.
                  </span>
                </li>
                <li className="flex gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-emerald-50 font-semibold text-[var(--brand)]">
                    3
                  </span>
                  <span>
                    Tap <strong>Add</strong>. Open AB Ramadan from the new
                    Home Screen icon.
                  </span>
                </li>
              </ol>
            ) : manualInstallPlatform === "android" ? (
              <ol className="mt-5 list-decimal space-y-3 pl-5 text-sm leading-6">
                <li>Open this page in Chrome on your phone.</li>
                <li>Tap the <strong>three-dot menu</strong>, then <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li>
                <li>Confirm, then open AB Ramadan from your Home Screen.</li>
              </ol>
            ) : (
              <ol className="mt-5 list-decimal space-y-3 pl-5 text-sm leading-6">
                <li>Open this page in Chrome or Edge.</li>
                <li>Choose the <strong>Install</strong> icon in the address bar, or open the browser menu and select <strong>Install page as app</strong>.</li>
                <li>Confirm. AB Ramadan will appear in your computer’s apps.</li>
              </ol>
            )}
            {manualInstallPlatform === "ios" && <p className="mt-4 text-xs leading-5 text-[var(--muted)]">If you cannot find Share or Add to Home Screen, open this page in Safari and try again.</p>}
            <p className="mt-4 text-xs leading-5 text-[var(--muted)]">Installing gives quick access and supports the POS offline queue. Other features may still need internet to load or sync.</p>
            <Button className="mt-6 w-full" onClick={closeManualInstructions}>
              Got it
            </Button>
          </section>
        </AppDialog>
      )}
    </>
  );
}

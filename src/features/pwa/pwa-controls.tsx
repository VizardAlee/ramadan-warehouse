"use client";

import { Download, RefreshCw, Share, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePwa } from "@/features/pwa/pwa-provider";

export function PwaControls() {
  const { installAvailable, manualInstallPlatform, showManualInstructions, updateAvailable, install, closeManualInstructions, applyUpdate } = usePwa();

  return <>
    {installAvailable && (
      <Button size="icon" variant="ghost" title="Install app" aria-label="Install ABR Warehouse app" onClick={() => void install()}>
        <Download className="size-4" />
      </Button>
    )}
    {updateAvailable && (
      <Button size="icon" variant="ghost" title="Update app" aria-label="Update ABR Warehouse app" onClick={applyUpdate}>
        <RefreshCw className="size-4" />
      </Button>
    )}
    {showManualInstructions && (
      <div className="fixed inset-0 z-[70] grid place-items-end bg-black/50 p-3 sm:place-items-center" role="dialog" aria-modal="true" aria-labelledby="ios-install-title">
        <section className="safe-bottom w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
          <div className="flex items-start justify-between gap-4">
            <div><h2 id="ios-install-title" className="text-xl font-semibold">{manualInstallPlatform === "mac-safari" ? "Install on Mac" : "Install on iPhone or iPad"}</h2><p className="mt-1 text-sm text-[var(--muted)]">{manualInstallPlatform === "mac-safari" ? "Safari can add ABR Warehouse to your Dock." : "Install this app from the browser Share menu."}</p></div>
            <Button size="icon" variant="ghost" aria-label="Close install instructions" onClick={closeManualInstructions}><X className="size-5" /></Button>
          </div>
          {manualInstallPlatform === "mac-safari" ? <ol className="mt-5 space-y-4 text-sm">
            <li className="flex gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-full bg-emerald-50 font-semibold text-[var(--brand)]">1</span><span>Open Safari&apos;s <strong>File</strong> menu.</span></li>
            <li className="flex gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-full bg-emerald-50 font-semibold text-[var(--brand)]">2</span><span>Choose <strong>Add to Dock</strong>, then confirm.</span></li>
          </ol> : <ol className="mt-5 space-y-4 text-sm">
            <li className="flex gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-full bg-emerald-50 font-semibold text-[var(--brand)]">1</span><span>Tap the browser&apos;s <strong className="inline-flex items-center gap-1">Share <Share className="size-4" /></strong> button.</span></li>
            <li className="flex gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-full bg-emerald-50 font-semibold text-[var(--brand)]">2</span><span>Choose <strong>Add to Home Screen</strong>.</span></li>
            <li className="flex gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-full bg-emerald-50 font-semibold text-[var(--brand)]">3</span><span>Tap <strong>Add</strong>. Open ABR Warehouse from the new Home Screen icon.</span></li>
          </ol>}
          <Button className="mt-6 w-full" onClick={closeManualInstructions}>Got it</Button>
        </section>
      </div>
    )}
  </>;
}

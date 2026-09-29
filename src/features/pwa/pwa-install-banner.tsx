"use client";

import { Download, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { usePwa } from "./pwa-provider";

const dismissKey = "abr-pwa-install-dismissed-until";
const dismissDurationMs = 14 * 24 * 60 * 60 * 1000;

export function PwaInstallBanner() {
  const { installed, installAvailable, install } = usePwa();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!installAvailable || installed) return;
    const timer = window.setTimeout(() => {
      try {
        if (Number(window.localStorage.getItem(dismissKey)) > Date.now()) return;
      } catch { /* Private browsing may block local storage. */ }
      setVisible(true);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [installAvailable, installed]);

  if (!visible || installed || !installAvailable) return null;

  const dismiss = () => {
    setVisible(false);
    try { window.localStorage.setItem(dismissKey, String(Date.now() + dismissDurationMs)); }
    catch { /* The banner still closes for this session. */ }
  };

  return (
    <section aria-label="Install AB Ramadan app" className="border-b border-indigo-200 bg-indigo-50 px-[var(--page-gutter)] py-3">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-[var(--brand)]"><Download className="size-5" /></span>
        <div className="min-w-0 flex-1 basis-52">
          <p className="text-sm font-semibold text-slate-900">Install AB Ramadan on this device</p>
          <p className="text-xs leading-5 text-slate-700">Open it like an app. Visit POS online once so supported sales can queue offline; other tasks may still need a connection.</p>
        </div>
        <Button type="button" size="sm" onClick={() => { dismiss(); void install(); }} className="shrink-0 gap-2">
          <Download className="size-4" /> Install app
        </Button>
        <button type="button" onClick={dismiss} aria-label="Dismiss install suggestion" title="Not now" className="grid size-10 shrink-0 place-items-center rounded-lg text-slate-600 hover:bg-white"><X className="size-4" /></button>
      </div>
    </section>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { callAdministration } from "@/features/administration/api";
import { useAuth } from "@/features/auth/auth-context";
import { detachBrowserPush, ownerKey, pushSupported } from "./push-subscription";

function decodeKey(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const decoded = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  const bytes = new Uint8Array(new ArrayBuffer(decoded.length));
  for (let index = 0; index < decoded.length; index++) bytes[index] = decoded.charCodeAt(index);
  return bytes;
}

export function BrowserPushControls() {
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const isSupported = pushSupported();

  useEffect(() => {
    if (!user || !isSupported) return;
    let cancelled = false;
    void (async () => {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      const owner = localStorage.getItem(ownerKey);
      if (subscription && owner && owner !== user.uid) {
        await subscription.unsubscribe();
        localStorage.removeItem(ownerKey);
      }
      if (!cancelled) setEnabled(Boolean(subscription && owner === user.uid));
    })().catch(() => { if (!cancelled) setEnabled(false); });
    return () => { cancelled = true; };
  }, [user, isSupported]);

  const enable = async () => {
    if (!user || !isSupported) return;
    setBusy(true); setMessage(null);
    try {
      // Safari requires the permission prompt to begin in the direct click gesture.
      const permissionPromise = Notification.requestPermission();
      const result = await callAdministration<object, { publicKey: string | null }>("getWebPushPublicKey", {});
      if (!result.publicKey) throw new Error("Browser push is not configured yet. The inbox remains available.");
      const permission = await permissionPromise;
      if (permission !== "granted") throw new Error("Notifications were not allowed. You can change this in your browser settings.");
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeKey(result.publicKey) });
      const value = subscription.toJSON();
      if (!value.endpoint || !value.keys?.p256dh || !value.keys.auth) throw new Error("The browser did not return a usable subscription.");
      try {
        await callAdministration("saveWebPushSubscription", { endpoint: value.endpoint, keys: value.keys });
      } catch (error) {
        await subscription.unsubscribe();
        throw error;
      }
      localStorage.setItem(ownerKey, user.uid);
      setEnabled(true);
      setMessage("Browser notifications are on for this device.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not enable browser notifications."); }
    finally { setBusy(false); }
  };

  const disable = async () => {
    setBusy(true); setMessage(null);
    try { await detachBrowserPush(); setEnabled(false); setMessage("Browser notifications are off for this device."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not disable browser notifications."); }
    finally { setBusy(false); }
  };

  return <section className="rounded-xl border bg-white p-4" aria-label="Browser notification settings">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="font-semibold">Browser notifications</h2><p className="text-sm text-[var(--muted)]">Optional alerts on this device. Your in-app inbox remains the record of every task.</p></div>
      {isSupported && <Button disabled={busy} onClick={() => void (enabled ? disable() : enable())}>{busy ? "Please wait…" : enabled ? "Turn off" : "Enable on this device"}</Button>}
    </div>
    {!isSupported && <p className="mt-2 text-sm text-amber-800">Push is unavailable in this browser. On iPhone, add the app to your Home Screen, then open it there.</p>}
    {message && <p role="status" className="mt-2 text-sm">{message}</p>}
  </section>;
}

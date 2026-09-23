import { callAdministration } from "@/features/administration/api";

export const ownerKey = "abr-push-owner";

export function pushSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator && "PushManager" in window && window.isSecureContext;
}

export async function detachBrowserPush(): Promise<void> {
  if (!pushSupported()) return;
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) {
    try { await callAdministration("removeWebPushSubscription", { endpoint: subscription.endpoint }); } catch { /* Expired endpoints are removed by the delivery worker. */ }
    await subscription.unsubscribe();
  }
  localStorage.removeItem(ownerKey);
}

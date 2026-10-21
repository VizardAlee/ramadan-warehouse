import { httpsCallableFromURL } from "firebase/functions";
import { getFirebaseServices } from "@/lib/firebase/client";
import { readStoredOperatingContext } from "@/features/auth/operating-context";
import { sanitizeSupportContext, type SupportInput } from "../../../functions/src/support/domain";

export type SupportTicket = { id: string; submittedByUid?: string; kind: string; description: string; expected: string; context: SupportInput["context"]; scope: { type: string; id: string }; roles: string[]; hasScreenshot: boolean; status: "new" | "in_progress" | "resolved"; revision: number; createdAt: number; updatedAt: number; notification?: "sent" | "pending"; notificationState?: string; canRetryNotification?: boolean };
export type SupportPage = { tickets: SupportTicket[]; nextCursor: string | null; canAdmin: boolean };
export type SupportConfig = { url: string; build: string };
export const supportGatewayUrl = (url: unknown): url is string => typeof url === "string" && /^https:\/\/ramadan-support-gateway-[a-z0-9-]+\.[a-z0-9-]+\.gateway\.dev\/supportWorkspace$/.test(url);
export async function loadSupportConfig(): Promise<SupportConfig> {
  const response = await fetch("/api/support-config", { cache: "no-store", credentials: "same-origin" });
  const value = await response.json();
  if (!response.ok || !supportGatewayUrl(value.url)) throw new Error("Private support is not configured yet. Your report has not been submitted. Contact your administrator for help.");
  return { url: value.url, build: typeof value.build === "string" && /^[-a-zA-Z0-9_.:]{1,80}$/.test(value.build) ? value.build : "unknown" };
}
export async function callSupport<T>(config: SupportConfig, input: Record<string, unknown>): Promise<T> {
  if (!supportGatewayUrl(config.url)) throw new Error("Private support is unavailable.");
  const { functions, auth } = getFirebaseServices();
  if (!auth.currentUser) throw new Error("Sign in to use private support.");
  const callable = httpsCallableFromURL<Record<string, unknown>, T>(functions, config.url, { timeout: 40000 });
  const operatingContext = readStoredOperatingContext();
  return (await callable({ ...input, ...(operatingContext ? { operatingContext } : {}) })).data;
}
export function supportContext(screen: string, build: string, errorReference: string) {
  const agent = navigator.userAgent;
  return sanitizeSupportContext({ screen, build, clientTime: new Date().toISOString(), errorReference, device: window.innerWidth < 600 ? "mobile" : window.innerWidth < 1000 ? "tablet" : "desktop", browser: /Edg\//.test(agent) ? "Edge" : /Firefox\//.test(agent) ? "Firefox" : /Chrome\//.test(agent) ? "Chrome" : /Safari\//.test(agent) ? "Safari" : "Other" });
}
export { prepareSupportScreenshot } from "./screenshot";

import { getFirebaseConfig } from "@/lib/firebase/config";

/** Only map this project's standard reset links. Preserve all other action flows. */
export function passwordSetupLink(link: string | null, appOrigin: string): string | null {
  if (!link) return null;
  try {
    const config = getFirebaseConfig();
    const source = new URL(link);
    const target = new URL("/setup-password", appOrigin);
    if (source.protocol !== "https:" || target.protocol !== "https:" || source.username || source.password
      || ![config.authDomain, `${config.projectId}.firebaseapp.com`].includes(source.host)
      || source.pathname !== "/__/auth/action" || source.searchParams.get("mode") !== "resetPassword"
      || !source.searchParams.get("oobCode")) return link;
    target.searchParams.set("mode", "resetPassword");
    target.searchParams.set("oobCode", source.searchParams.get("oobCode")!);
    return target.href;
  } catch { return link; }
}

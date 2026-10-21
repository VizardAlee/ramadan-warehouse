export const dynamic = "force-dynamic";
/** Non-secret deployment configuration only. Never returns tickets, tokens or credentials. */
export async function GET() {
  const url = process.env.RAMADAN_SUPPORT_GATEWAY_URL ?? "";
  const valid = /^https:\/\/ramadan-support-gateway-[a-z0-9-]+\.[a-z0-9-]+\.gateway\.dev\/supportWorkspace$/.test(url);
  const revision = process.env.K_REVISION ?? "unknown";
  return Response.json({ url: valid ? url : "", build: /^[-a-zA-Z0-9_.:]{1,80}$/.test(revision) ? revision : "unknown" }, { status: valid ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}

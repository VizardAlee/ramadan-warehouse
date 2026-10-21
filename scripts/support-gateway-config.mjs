import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Render only; no cloud mutation, authentication material or secrets. */
export function supportGatewayConfig(backendUrl) {
  if (typeof backendUrl !== "string" || !/^https:\/\/(?:supportworkspace-[a-z0-9]+-uc\.a\.run\.app|supportworkspace-482160397815\.us-central1\.run\.app)$/.test(backendUrl)) throw new Error("Use the verified, untagged supportWorkspace Cloud Run URI from deployment metadata.");
  const backend = { address: backendUrl, jwt_audience: backendUrl, path_translation: "CONSTANT_ADDRESS", deadline: 35 };
  return {
    swagger: "2.0", info: { title: "Ramadan private support", version: "1.0.0" }, schemes: ["https"], consumes: ["application/json"], produces: ["application/json"],
    securityDefinitions: { firebase: { type: "oauth2", flow: "implicit", authorizationUrl: "", "x-google-issuer": "https://securetoken.google.com/ramadan-warehouse-staging", "x-google-jwks_uri": "https://www.googleapis.com/service_accounts/v1/metadata/x509/securetoken@system.gserviceaccount.com", "x-google-audiences": "ramadan-warehouse-staging" } },
    paths: { "/supportWorkspace": {
      post: { operationId: "privateSupportWorkspace", security: [{ firebase: [] }], "x-google-backend": backend, responses: { 200: { description: "Authorized private support result" } } },
      options: { operationId: "privateSupportPreflight", security: [], "x-google-backend": backend, responses: { 204: { description: "Exact-origin CORS preflight; never executes a ticket action" } } },
    } },
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [backendUrl, output] = process.argv.slice(2);
  if (!output) throw new Error("Usage: node scripts/support-gateway-config.mjs VERIFIED_CLOUD_RUN_URI OUTPUT_JSON");
  writeFileSync(output, JSON.stringify(supportGatewayConfig(backendUrl), null, 2) + "\n");
  console.log("Non-secret Gateway configuration rendered. No resource was created or deployed.");
}

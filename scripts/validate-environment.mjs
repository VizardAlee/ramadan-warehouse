import { existsSync, readFileSync } from "node:fs";

const target = process.argv[2] ?? "example";
const file = target === "example" ? ".env.example" : `.env.${target}`;
if (!existsSync(file)) throw new Error(`${file} is required. Copy its example and provide non-secret project configuration.`);
const values = Object.fromEntries(readFileSync(file, "utf8").split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line) => { const separator = line.indexOf("="); return [line.slice(0, separator), line.slice(separator + 1)]; }));
const required = ["NEXT_PUBLIC_FIREBASE_API_KEY", "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", "NEXT_PUBLIC_FIREBASE_PROJECT_ID", "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET", "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID", "NEXT_PUBLIC_FIREBASE_APP_ID", "APP_ENV", "GCLOUD_PROJECT", "FUNCTIONS_REGION", "LOG_LEVEL", "NOTIFICATION_ADAPTER_MODE", "INTEGRATION_ADAPTER_MODE", "WAREHOUSE_APP_CHECK_ENABLED", "WAREHOUSE_BOOTSTRAP_ENABLED", "WAREHOUSE_SCHEDULED_FUNCTIONS_ENABLED"];
const missing = required.filter((key) => !values[key]);
if (missing.length) throw new Error(`Missing environment values in ${file}: ${missing.join(", ")}`);
if (["staging", "production"].includes(target)) {
  if (values.APP_ENV !== target) throw new Error(`APP_ENV must be ${target}.`);
  if (values.WAREHOUSE_APP_CHECK_ENABLED !== "true" || !values.NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY) throw new Error("App Check must be fully configured.");
  if (values.NEXT_PUBLIC_USE_FIREBASE_EMULATORS !== "false" || Object.keys(values).some((key) => key.endsWith("EMULATOR_HOST"))) throw new Error("Emulator configuration is forbidden for this target.");
  if (values.GCLOUD_PROJECT !== values.NEXT_PUBLIC_FIREBASE_PROJECT_ID) throw new Error("Browser and Functions project IDs must match.");
  if (values.NEXT_PUBLIC_FIREBASE_PROJECT_ID.startsWith("demo-")) throw new Error("Demo/emulator Firebase projects are forbidden.");
  if (target === "staging" && values.PRODUCTION_FIREBASE_PROJECT_ID && values.PRODUCTION_FIREBASE_PROJECT_ID === values.NEXT_PUBLIC_FIREBASE_PROJECT_ID) throw new Error("Staging and production Firebase project IDs must differ.");
  if (target === "production" && values.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== "ramadan-warehouse-staging") throw new Error("Production must use the owner-approved immutable Firebase project ID.");
  if (values.NEXT_PUBLIC_FIREBASE_APPCHECK_DEBUG_TOKEN !== "false") throw new Error("App Check debug mode must be explicitly disabled.");
  if (!values.WAREHOUSE_REQUIRED_SECRETS?.split(",").includes("WAREHOUSE_BOOTSTRAP_SECRET")) throw new Error("Required server secrets must be declared by Secret Manager name.");
  if (!["noop", "log"].includes(values.NOTIFICATION_ADAPTER_MODE)) throw new Error("Notification adapter must default to noop or log.");
  if (!["noop", "mock"].includes(values.INTEGRATION_ADAPTER_MODE)) throw new Error("Integration adapter must default to noop or mock.");
  if (!["true", "false"].includes(values.WAREHOUSE_SCHEDULED_FUNCTIONS_ENABLED)) throw new Error("Scheduled functions must be explicitly enabled or disabled.");
  if (Object.keys(values).some((key) => key.startsWith("NEXT_PUBLIC_") && /(SECRET|PRIVATE|SIGNING|PASSWORD|CREDENTIAL)/i.test(key))) throw new Error("Server secrets must never use NEXT_PUBLIC_* names.");
  if (Object.values(values).some((value) => value.includes("replace-with"))) throw new Error(`${file} still contains placeholder values.`);
}
console.log(`Environment validation passed for ${target}.`);

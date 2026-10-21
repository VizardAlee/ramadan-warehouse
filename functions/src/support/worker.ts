import { defineSecret } from "firebase-functions/params";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { db } from "../admin.js";
import { runSupportMailBatch } from "./dispatch.js";

export const supportGmailPassword = defineSecret("RAMADAN_SUPPORT_GMAIL_APP_PASSWORD");
// No secret is loaded at module initialization or in the ticket API.
export const deliverSupportMail = onSchedule({ schedule: "every 1 minutes", timeZone: "Africa/Lagos", serviceAccount: "ramadan-support-mail-runtime@ramadan-warehouse-staging.iam.gserviceaccount.com", secrets: process.env.FUNCTIONS_EMULATOR === "true" ? [] : [supportGmailPassword], timeoutSeconds: 90, memory: "256MiB", maxInstances: 1, concurrency: 1, retryCount: 0 }, async () => {
  // Emulator runs never load production credentials or contact Gmail.
  if (process.env.FUNCTIONS_EMULATOR === "true") return;
  await runSupportMailBatch(db, () => supportGmailPassword.value());
});

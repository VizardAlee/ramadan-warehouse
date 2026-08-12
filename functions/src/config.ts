import { setGlobalOptions } from "firebase-functions/v2";
import { defineSecret } from "firebase-functions/params";
import { parseServerEnvironment } from "./environment.js";

export const environment = parseServerEnvironment(process.env);

setGlobalOptions({ region: environment.FUNCTIONS_REGION, maxInstances: 20, timeoutSeconds: 30, memory: "256MiB" });

export const enforceAppCheck = environment.APP_ENV === "emulator" ? false : environment.WAREHOUSE_APP_CHECK_ENABLED;
export const bootstrapSecret = defineSecret("WAREHOUSE_BOOTSTRAP_SECRET");
export const bootstrapSecrets = process.env.FUNCTIONS_EMULATOR === "true" ? [] : [bootstrapSecret];

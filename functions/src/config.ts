import { setGlobalOptions } from "firebase-functions/v2";

setGlobalOptions({ region: "us-central1", maxInstances: 20, timeoutSeconds: 30, memory: "256MiB" });

export const enforceAppCheck = process.env.FUNCTIONS_EMULATOR !== "true";

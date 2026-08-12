import { describe, expect, it } from "vitest";
import { parseServerEnvironment } from "../functions/src/environment";

describe("server environment validation", () => {
  it("accepts explicit emulator settings", () => {
    expect(parseServerEnvironment({ FUNCTIONS_EMULATOR: "true", GCLOUD_PROJECT: "demo-test" }).APP_ENV).toBe("emulator");
  });

  it("rejects missing production App Check configuration", () => {
    expect(() => parseServerEnvironment({ APP_ENV: "production", GCLOUD_PROJECT: "warehouse-prod" })).toThrow("App Check");
  });

  it("rejects emulator configuration in production", () => {
    expect(() => parseServerEnvironment({ APP_ENV: "production", GCLOUD_PROJECT: "warehouse-prod", WAREHOUSE_APP_CHECK_ENABLED: "true", FIRESTORE_EMULATOR_HOST: "127.0.0.1:8180" })).toThrow("Emulator hosts");
  });
});

import { z } from "zod";

const booleanValue = z.enum(["true", "false"]).transform((value) => value === "true");

export const serverEnvironmentSchema = z
  .object({
    APP_ENV: z.enum(["development", "emulator", "staging", "production"]),
    GCLOUD_PROJECT: z.string().trim().min(1),
    FUNCTIONS_REGION: z.string().trim().min(1).default("us-central1"),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    NOTIFICATION_ADAPTER_MODE: z.enum(["noop", "log", "emulator"]).default("noop"),
    INTEGRATION_ADAPTER_MODE: z.enum(["noop", "log", "mock"]).default("noop"),
    WAREHOUSE_APP_CHECK_ENABLED: booleanValue.default(false),
    WAREHOUSE_BOOTSTRAP_ENABLED: booleanValue.default(false),
    WAREHOUSE_SCHEDULED_FUNCTIONS_ENABLED: booleanValue.default(false),
    FIRESTORE_EMULATOR_HOST: z.string().trim().min(1).optional(),
    FIREBASE_AUTH_EMULATOR_HOST: z.string().trim().min(1).optional(),
  })
  .superRefine((environment, context) => {
    if (["staging", "production"].includes(environment.APP_ENV)) {
      if (environment.GCLOUD_PROJECT.startsWith("demo-"))
        context.addIssue({ code: "custom", path: ["GCLOUD_PROJECT"], message: "Staging and production cannot use a demo project." });
      if (!environment.WAREHOUSE_APP_CHECK_ENABLED)
        context.addIssue({ code: "custom", path: ["WAREHOUSE_APP_CHECK_ENABLED"], message: "App Check must be enabled outside local environments." });
      if (environment.FIRESTORE_EMULATOR_HOST || environment.FIREBASE_AUTH_EMULATOR_HOST)
        context.addIssue({ code: "custom", path: ["APP_ENV"], message: "Emulator hosts are forbidden in staging and production." });
    }
    if (environment.APP_ENV === "emulator" && !environment.GCLOUD_PROJECT.startsWith("demo-"))
      context.addIssue({ code: "custom", path: ["GCLOUD_PROJECT"], message: "Emulator mode requires a demo project ID." });
  });

export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;

export function parseServerEnvironment(input: Readonly<Record<string, string | undefined>>): ServerEnvironment {
  const inferredMode = input.FUNCTIONS_EMULATOR === "true" ? "emulator" : "development";
  const result = serverEnvironmentSchema.safeParse({
    ...input,
    APP_ENV: input.APP_ENV ?? inferredMode,
    GCLOUD_PROJECT: input.GCLOUD_PROJECT ?? input.GOOGLE_CLOUD_PROJECT ?? (inferredMode === "emulator" ? "demo-ramadan-warehouse" : "local-development"),
  });
  if (!result.success) {
    const details = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid server environment: ${details}`);
  }
  return result.data;
}

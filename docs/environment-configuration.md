# Environment configuration

Four application modes are supported: development, emulator, staging, and production. The current cloud environment is production even though its immutable project ID is `ramadan-warehouse-staging`. Browser variables are limited to Firebase public web configuration. Server behavior uses `APP_ENV`, `GCLOUD_PROJECT`, `FUNCTIONS_REGION`, `LOG_LEVEL`, adapter modes, and explicit bootstrap/scheduler/App Check flags. Secrets never use `NEXT_PUBLIC_`.

Copy the appropriate example to an untracked environment file. Production rejects demo IDs, emulator hosts, missing App Check enablement, mismatched IDs, placeholders, an ID other than the explicitly approved immutable project, and deployment outside `main`. Emulator mode requires `demo-ramadan-warehouse` and is the default pre-production environment until a separate staging project becomes available.

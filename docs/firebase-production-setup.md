# Firebase production setup checklist

The owner selected immutable project ID `ramadan-warehouse-staging` for production because billing capacity does not currently permit a separate project. The project cannot be renamed. Representative recovery passed, production configuration was deployed, and synthetic data was reset. See `production-conversion.md`.

Recovery passed before conversion. Production uses a reviewed single authoritative `production` alias mapped to that exact ID, production runtime semantics, least-privilege deploy/runtime identities, Auth authorized domains, email actions, App Check enforcement, Secret Manager values, Scheduler, monitoring, budget, log retention, and managed backups. Deploy from `main` only after the full production gate. Keep emulator variables absent and notification/integration adapters explicitly `noop` until real integrations are approved. A future cloud staging environment must use a new project; the local Emulator Suite is the pre-production environment until then.

The sole cloud alias is `production`. All 98 Functions run Node 22 with `APP_ENV=production`, App Check enabled, scheduled functions enabled, and both adapters `noop`. Rules/indexes are current, Hosting is HTTP 200, monitoring and uptime use production labels, backups retain seven days, and the approved budget is unchanged.

Firestore is clean and bootstrap ready. Only verified owner identity `servicegurunigeria@gmail.com` remains. Production bootstrap awaits owner-supplied legal organization name and organization code; no master or opening-inventory data may be guessed.

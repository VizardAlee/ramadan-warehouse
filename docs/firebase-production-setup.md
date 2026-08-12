# Firebase production setup checklist

The owner selected immutable project ID `ramadan-warehouse-staging` for production because billing capacity does not currently permit a separate project. The project cannot be renamed. Representative recovery passed, production configuration was deployed, and synthetic data was reset. See `production-conversion.md`.

Recovery passed before conversion. Production uses a reviewed single authoritative `production` alias mapped to that exact ID, production runtime semantics, least-privilege deploy/runtime identities, Auth authorized domains, email actions, App Check enforcement, Secret Manager values, Scheduler, monitoring, budget, log retention, and managed backups. Deploy from `main` only after the full production gate. Keep emulator variables absent and notification/integration adapters explicitly `noop` until real integrations are approved. A future cloud staging environment must use a new project; the local Emulator Suite is the pre-production environment until then.

The sole cloud alias is `production`. All 98 Functions run Node 22 with `APP_ENV=production`, App Check enabled, scheduled functions enabled, and both adapters `noop`. Rules/indexes are current, Hosting is HTTP 200, monitoring and uptime use production labels, backups retain seven days, and the approved budget is unchanged.

Production bootstrap completed for `AB Ramadan Ltd.` (`ABR`). Verified owner `servicegurunigeria@gmail.com` has an active `system_administrator` profile and matching authorization-version-1 claims. The one-time bootstrap guard and audit evidence are present. No branch, warehouse, additional user, product, or opening inventory was guessed or created.

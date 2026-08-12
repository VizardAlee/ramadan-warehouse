# App Check

Callable enforcement is controlled only by validated server environment, never client input. Emulator mode disables enforcement explicitly. Staging/production validation requires `WAREHOUSE_APP_CHECK_ENABLED=true` and a public web site key. Debug tokens must remain local and deployment validation scans tracked files for the debug-token switch.

Rollout: register reCAPTCHA Enterprise, observe unenforced metrics, validate authorized domains, enable callable enforcement, then monitor rejected attestations. Invalid/missing attestations return the callable platform error; tokens and full request headers must never be logged. Storage remains deny-all until binary attachment support is approved.

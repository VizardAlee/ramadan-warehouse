# App Check

Callable enforcement is controlled only by validated server environment, never client input. Emulator mode disables enforcement explicitly. Staging/production validation requires `WAREHOUSE_APP_CHECK_ENABLED=true` and a public web site key. Debug tokens must remain local and deployment validation scans tracked files for the debug-token switch.

Rollout: register reCAPTCHA Enterprise, observe unenforced metrics, validate authorized domains, enable callable enforcement, then monitor rejected attestations. Every served hostname must be present on the reCAPTCHA Enterprise web key before traffic is sent there, including Firebase Hosting, App Hosting, and each custom domain. Mobile Safari can otherwise retain a valid Firebase Auth session while callable requests arrive with App Check marked `MISSING`; this is an App Check domain configuration failure, not an expired user session.

After adding or changing a custom domain, verify the key allowlist with `gcloud recaptcha keys list`, exercise a callable from that hostname on both mobile Safari and Chromium, and confirm Cloud Run logs report both `app: VALID` and `auth: VALID`. Keep enforcement enabled during this correction. Invalid/missing attestations return the callable platform error; tokens and full request headers must never be logged. Storage remains deny-all until binary attachment support is approved.

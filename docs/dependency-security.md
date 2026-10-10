# Dependency and supply-chain security

Use `npm ci` with the committed lockfiles and Node 22.12 or newer on the supported Node 22 or 24 lines. CI and deployed Functions use Node 22. Pin direct dependencies, review lockfile integrity changes, run both production dependency audits, and retain the high-severity release gate and secret scan. An audit endpoint or network failure is not a clean result.

## Local remediation review: 2026-10-10

The customer-statement review found production dependency vulnerabilities. The local remediation updates Next.js and its ESLint configuration to 16.4.0, Firebase browser SDK to 12.19.0, Firebase Admin to 14.5.0 in both dependency trees, Functions google-auth-library to 11.1.0, Firebase Tools to 15.33.0, Vitest to the patched 4.1.11 line, and Node type definitions to 22.20.5. Firebase Admin 14 requires Node 22 and modular imports; the repository already uses those imports. No Firebase browser SDK 13 or forced downgrade was introduced.

Two root overrides address dependencies pinned by their parents:

- `@firebase/firestore` uses `@grpc/grpc-js` 1.14.6 instead of its affected 1.9.x pin. This stays within gRPC's 1.x API. Emulator Rules and callable workflows must pass against this resolution.
- `gaxios@6.7.1` uses `uuid` 11.1.1. Its installed code uses only the exported `v4()` function to generate multipart boundaries. A CommonJS require and UUID v4 validity smoke check passed; the full regression verifies the consuming tooling.

Fresh `npm ci` installations passed for the root and Functions trees. The root production and Functions production audits returned zero findings. The full root audit retains 13 development-tool findings (11 high, 2 moderate), with no critical findings: `braces` through micromatch/fast-glob/Next ESLint and chokidar/Firebase Tools; `basic-ftp` through get-uri/pac-proxy-agent/proxy-agent/Firebase Tools; and `@opentelemetry/core` through Google Pub/Sub/Firebase Tools. These tools are excluded from the production audit, but the full audit remains failing.

The registry currently has no patched `braces` release. The FTP and OpenTelemetry fixes cross major versions outside the consuming packages' supported dependency ranges. Do not force those versions, downgrade Firebase/Next.js to obsolete lines suggested by audit metadata, or suppress audit results. Keep development tooling private and track compatible upstream fixes. This local dependency change is not deployed; publication and authenticated client acceptance remain separate.

Maintainer references: [Firebase Admin release notes](https://firebase.google.com/support/release-notes/admin/node), [Firebase browser SDK release notes](https://firebase.google.com/support/release-notes/js), [Vitest 4 migration guide](https://v4.vitest.dev/guide/migration), and the advisory details returned by the configured official npm registry audit.

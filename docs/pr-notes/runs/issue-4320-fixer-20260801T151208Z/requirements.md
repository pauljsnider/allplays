# Requirements

Upgrade Firebase from exactly `12.16.0` to `12.17.0` in the root and React app manifests and in both npm lockfiles plus the app pnpm lockfile. Keep Firebase configuration, application behavior, Capacitor plugin versions, security rules, Functions, and service-worker CDN imports unchanged.

Acceptance evidence:

- Both manifests and all three lockfiles resolve Firebase `12.17.0` consistently.
- App Check, authentication, messaging, and performance peer bindings resolve cleanly.
- Existing Firebase initialization, sign-in, authenticated data-adapter, and push-service tests pass.
- The React app builds with the real package graph.

The change is dependency metadata, so the prevention-oriented regression is the existing dependency contract updated to reject partial npm/pnpm lockfile upgrades. Existing behavior tests remain the correct guard for unchanged runtime paths.

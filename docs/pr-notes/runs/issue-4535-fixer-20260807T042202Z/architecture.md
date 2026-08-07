# Architecture review

## Current state

The repository has independent root and React/Capacitor npm graphs plus a maintained app pnpm lock. Both manifests pin direct Firebase to `12.17.0` and allow `web-vitals` through `^6.0.1`. The npm and pnpm locks resolve direct Firebase to `12.17.0` and direct `web-vitals` to `6.0.1`. CI installs the root and app graphs independently.

## Proposed state

- Pin direct Firebase to `12.17.1` in both manifests and every lock surface.
- Refresh only direct `web-vitals` to `6.1.0`, retaining the manifest range `^6.0.1`.
- Leave Firebase Performance's independent nested `web-vitals@4.2.4` resolution unchanged.
- Allow package managers to refresh only transitive entries required by Firebase `12.17.1`, including `@firebase/data-connect` and `@firebase/database-compat` if required by registry metadata.

## Files and mechanism

Update `package.json`, `package-lock.json`, `apps/app/package.json`, `apps/app/package-lock.json`, `apps/app/pnpm-lock.yaml`, and the existing dependency-alignment test. Use targeted npm package-lock operations and a targeted pnpm lock-only update. Do not hand-edit integrity hashes or refresh unrelated packages.

## Risk, blast radius, and rollback

Runtime risk is low but nonzero because Firebase is shared across Auth, Firestore, App Check, messaging, and performance, while `web-vitals` feeds telemetry. The blast radius is dependency resolution only: no tenant data, PHI, authorization, rules, or browser cache-critical modules change. Rollback is a single atomic commit revert; partial rollback of one graph is invalid.

## Validation

Verify exact manifest/importer/direct-package versions across all locks, Capacitor Firebase peer-qualified pnpm keys, and preservation of nested `web-vitals@4.2.4`. Run clean installs, the focused dependency contract, relevant Firebase/web-vitals tests, and the app production build. Native Gradle/Xcode and broad smoke suites remain CI responsibilities.

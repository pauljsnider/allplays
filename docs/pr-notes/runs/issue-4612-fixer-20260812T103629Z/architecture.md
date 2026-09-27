# Architecture

## Current-State Read

App Check is exact-pinned at `8.3.0` in two manifests and resolved at that version in two npm lockfiles plus the app pnpm lockfile. Native projects refer to the plugin by stable package path, so no native configuration edit is needed.

## Proposed Design

Update only App Check to `8.4.0`, regenerate all associated lockfiles, and update the existing dependency contract to distinguish App Check from the other Capacitor Firebase plugins that remain at `8.3.0`.

## Files And Modules Touched

- `package.json`
- `package-lock.json`
- `apps/app/package.json`
- `apps/app/package-lock.json`
- `apps/app/pnpm-lock.yaml`
- `tests/unit/app-capacitor-native-config.test.js`

## Data/State Impacts

No application data, schema, authentication state, or persisted user state changes. Only clean-install dependency resolution changes.

## Security/Permissions Impacts

No rules or authorization boundary changes. App Check remains wired identically. Exact pins and integrity-bearing lockfiles preserve deterministic supply-chain control.

## Failure Modes And Mitigations

- Partial artifact refresh: prevent with a cross-manifest and cross-lockfile test.
- Over-broad plugin upgrade: use explicit per-plugin expected versions.
- Native incompatibility: focused app build locally and mobile build in CI.
- Unrelated lockfile churn: inspect and constrain the diff.

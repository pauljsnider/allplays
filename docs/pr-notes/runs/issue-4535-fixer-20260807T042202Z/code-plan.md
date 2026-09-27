# Code plan

Base SHA: `3bbb23bae3204aab6b5159f912da336a5bee8e2a`

## Edit sequence

1. Update the existing dependency-alignment test to require Firebase `12.17.1`, direct `web-vitals` `6.1.0`, matching pnpm importer/package/snapshot/plugin peer entries, and rejection of stale Firebase `12.17.0` peer keys.
2. Prove the focused contract fails before the dependency update.
3. Pin Firebase `12.17.1` in both manifests. Keep `web-vitals` at `^6.0.1`.
4. Use targeted npm lock-only operations for both graphs, then a targeted app pnpm lock-only update.
5. Inspect the complete diff and reject unrelated dependency churn.
6. Run clean installs, focused tests, and the app build.

## Expected files

- `package.json`
- `package-lock.json`
- `apps/app/package.json`
- `apps/app/package-lock.json`
- `apps/app/pnpm-lock.yaml`
- `tests/unit/app-capacitor-native-config.test.js`
- Four role artifacts in this run directory

## RCA and prevention

Root cause: exact Firebase pins and deterministic locks kept the scanned dependency cohort stale, while the admissible web-vitals range did not automatically refresh its locks. Prevention: treat both manifests, both npm locks, and the app pnpm lock as one cohort and enforce the exact direct resolutions plus Capacitor Firebase peer suffixes in the existing alignment test. Recurrence risk is low because a partial update will fail at the lockfile contract boundary.

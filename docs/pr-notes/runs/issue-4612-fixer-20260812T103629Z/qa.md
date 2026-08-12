# QA

## Risk Matrix

- Medium: drift across two manifests and three lockfiles.
- Medium: a native App Check incompatibility could block authenticated Firebase requests.
- Low: no UI, rules, or business-flow code changes.

## Automated Tests To Add/Update

Update `tests/unit/app-capacitor-native-config.test.js` to assert App Check `8.4.0` across both manifests, both npm lockfile importers and resolved entries, and the pnpm importer/package/snapshot. Preserve existing native wiring assertions.

## Manual Test Plan

Review the diff for dependency scope and confirm `npm outdated` no longer identifies App Check as actionable.

## Negative Tests

The contract must fail if any manifest, npm lockfile, or pnpm lockfile retains App Check `8.3.0`. Existing assertions continue to protect Android and iOS wiring.

## Release Gates

- Focused Vitest file passes.
- App build passes.
- No unrelated dependency churn.
- CI unit, app-quality, and mobile-build gates pass on the PR head.

## Post-Deploy Checks

On the next native candidate, monitor valid, invalid, and missing App Check token metrics and native error telemetry before expanding rollout.

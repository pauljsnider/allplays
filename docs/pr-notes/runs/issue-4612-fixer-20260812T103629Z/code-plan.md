# Code Plan

## Patch Plan

1. Update the exact App Check pin to `8.4.0` in both manifests.
2. Regenerate both npm lockfiles and the app pnpm lockfile.
3. Extend the existing native-config contract across all five dependency artifacts.
4. Keep authentication, messaging, and performance at their current resolved versions.

## Code Changes Applied

- Updated App Check from `8.3.0` to `8.4.0` in both manifests, both npm lockfiles, and the app pnpm lockfile.
- Expanded the existing native-config contract to verify every App Check dependency surface.
- Preserved authentication, messaging, performance, native configuration, and runtime source unchanged.

## Validation Run

Completed:

- `npx vitest run tests/unit/app-capacitor-native-config.test.js --reporter=verbose`: 16 tests passed.
- `npm --prefix apps/app run build`: TypeScript and Vite build passed.
- Root and app dependency trees resolve App Check `8.4.0` with Capacitor Core `8.5.0` and Firebase `12.17.1`.
- `npm outdated @capacitor-firebase/app-check --json`: `{}`.

## Residual Risks

The local checks do not execute native App Check attestation. GitHub CI mobile-build and post-release token telemetry remain the integration controls.

## Commit Message Draft

`Update App Check dependency to 8.4.0 (#4612)`

## Synthesis

### Acceptance Criteria

All package artifacts resolve App Check `8.4.0`; focused tests and the app build pass; no unrelated dependency changes occur.

### Architecture Decisions

Preserve exact pinning, update App Check alone, and leave native configuration untouched.

### QA Plan

Use the existing native-config unit contract as the prevention-oriented regression and CI as the native integration gate.

### Implementation Plan

Regenerate package artifacts with their package managers, then make the smallest test update needed to encode independent plugin versions.

### Risks And Rollback

Blast radius is the native/web App Check bridge. Roll back by reverting the two manifests, three lockfiles, and matching test expectation as one coherent commit.

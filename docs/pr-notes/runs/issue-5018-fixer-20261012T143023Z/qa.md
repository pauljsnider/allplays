# QA analysis

## Regression strategy

Update the existing cross-file contract test before changing dependencies. The focused test should initially fail on every stale expected version, then pass only after manifests, lockfiles, and native pins are aligned.

Assertions must cover:

- Root manifest specifiers and resolved versions for the three Capacitor runtime packages.
- App and root declarations/resolutions for speech recognition, jsdom, and web-vitals.
- The SwiftPM exact requirement and `Package.resolved` version matching the npm-resolved iOS runtime.
- Android Gradle wiring continuing to reference the npm-installed Capacitor project.
- Absence of an app-local pnpm lock remains enforced by the existing package-manager contract.

## Focused validation

1. Run `npx vitest run tests/unit/app-capacitor-native-config.test.js` after the test-only edit and confirm failure.
2. Regenerate npm lockfiles with npm and rerun the focused contract test.
3. Run `npm --prefix apps/app run test:ci` because the app dependency graph changes.
4. Run `npm test` as the issue-specified root gate if time and environment permit.

Native Gradle/Xcode builds are deferred to CI; no native source behavior changes, and the static contract directly validates native version wiring.

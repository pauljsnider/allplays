# QA strategy

Base SHA: `3bbb23bae3204aab6b5159f912da336a5bee8e2a`

## Scope and failure modes

This dependency-only change updates Firebase `12.17.0` to `12.17.1` and direct `web-vitals` `6.0.1` to `6.1.0`. Primary failure modes are manifest/lock drift, unexpected transitive churn, missing exports, TypeScript or bundle incompatibility, and Capacitor Firebase peer mismatch.

## Regression coverage

Update the existing `tests/unit/app-capacitor-native-config.test.js` dependency-alignment contract rather than creating a duplicate version-only test. It already reads both manifests, both npm locks, and the app pnpm lock. Existing behavior coverage includes Firebase initialization/App Check tests plus app Firebase auth, performance instrumentation/wiring, and web-vitals tests. The production build validates real TypeScript/Vite exports.

## Deterministic validation

1. Run the updated alignment contract before dependency edits and confirm it fails against stale versions.
2. Run clean root and app npm installs from the generated locks.
3. Confirm installed direct Firebase and web-vitals versions in both graphs.
4. Run the focused alignment, Firebase initialization, app Firebase/runtime performance, and web-vitals tests.
5. Run the app production build and bundle-size checks.
6. Review the diff for unrelated package or source churn.

Do not run Android Gradle, Xcode, Capacitor sync, Playwright, or emulator suites locally because this patch does not change those surfaces; GitHub CI is the complete native/integration gate.

## Recurrence risk

Low once all maintained lock surfaces and the alignment contract move atomically. The remaining risk is bypassing that contract or using a broad package-manager refresh.

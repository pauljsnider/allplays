# QA

Update `tests/unit/app-capacitor-native-config.test.js` to assert Firebase `12.17.0` across both manifests, both npm locks, the app pnpm importer/package/snapshot, and all four Capacitor Firebase peer-qualified resolutions. It must also reject stale `firebase@12.16.0` entries.

Focused validation:

- `npx vitest run tests/unit/app-capacitor-native-config.test.js --reporter=verbose`
- App tests for `firebaseAuthRuntime`, `authService`, `legacyScheduleDb`, and `pushService`
- Root and app `npm ls` for Firebase plus the four Capacitor Firebase plugins
- Frozen pnpm lock resolution
- `npm run app:build`

Mocked unit tests prove code contracts, while the credentialed authenticated core smoke in CI remains the full existing-user sign-in and team-data proof.

# Requirements analysis

The dependency slice is intentionally coupled: every direct declaration of the listed packages must move together so the web app, React app, and native wrappers resolve a compatible Capacitor runtime. There is no user-facing behavior change.

## Acceptance interpretation

- Update `@capacitor/android`, `@capacitor/core`, and `@capacitor/ios` to 8.5.3 where those packages are directly declared.
- Update `@capgo/capacitor-speech-recognition` to 8.4.1, `jsdom` to 30.1.2, and `web-vitals` to 6.2.3 in both root and app manifests and npm lockfiles.
- Keep the iOS `capacitor-swift-pm` exact pin and resolved revision synchronized with `@capacitor/ios` 8.5.3.
- Verify Android continues to consume `@capacitor/android` from the root `node_modules` project path; there is no separate Android version literal to update.
- Update the existing native-config contract test so a partial future bump fails.

## Scope decision

The issue mentions `pnpm-lock.yaml`, but the repository has no current or historical tracked pnpm lock. Root `AGENTS.md` explicitly makes npm canonical and forbids introducing a pnpm lock. The safe interpretation is to update every existing declaration and leave the nonexistent pnpm artifact absent.

## User and operations impact

This maintenance-only change should preserve all workflows and native behavior. The primary operational risk is a partially updated dependency graph rather than a product UX regression.

# Architecture analysis

Capacitor runtime alignment spans three representations:

1. Root JavaScript dependencies provide `@capacitor/android`, `@capacitor/core`, and `@capacitor/ios` to the generated native projects.
2. `apps/app` directly consumes `@capacitor/core` and shared plugins at build time.
3. The iOS SwiftPM shell pins `capacitor-swift-pm` independently, while Android Gradle includes Capacitor from `../node_modules/@capacitor/android/capacitor` without a separate version literal.

The root cause of drift risk is duplicated version ownership across manifests, lockfiles, SwiftPM metadata, and a static contract test. Splitting updates by manifest cannot produce a coherent native graph.

## Minimal patch boundary

- Root and app `package.json` plus their canonical npm lockfiles.
- SwiftPM manifest and resolved pin for the Capacitor runtime.
- Existing `tests/unit/app-capacitor-native-config.test.js` expectations for the coupled package set.
- No application source, generated Gradle file, workflow, or unrelated dependency changes.

## Recurrence controls

Retain one focused contract test that reads both manifests, both npm lockfiles, SwiftPM metadata, and Android project wiring. It should encode the intended versions explicitly so stale or partial maintenance fails review and CI.

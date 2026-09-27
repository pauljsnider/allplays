# QA — Issue #4338

Bound to starting HEAD: `ed4cc306ab6bf965896e77d024828b703e61292b`

## Coverage gap

The existing native-config test validates JavaScript manifests and locks but passes while both committed iOS SwiftPM files retain Capacitor `8.4.2`. A read-only native contract against the starting HEAD fails as expected because the Swift manifest and resolved pin do not match `8.5.0`.

## Regression strategy

Extend `tests/unit/app-capacitor-native-config.test.js` to:

- Derive the expected iOS runtime version from the root lockfile.
- Assert `Package.swift` uses that exact `capacitor-swift-pm` version.
- Find exactly one `capacitor-swift-pm` pin in `Package.resolved` and assert its resolved version matches.
- Reject stale `8.4.2` references in both native files.
- Avoid hardcoding Xcode's generated `originHash`.

Existing profile-photo tests are sufficient for unchanged workflow logic. They cover Camera availability, `Camera.getPhoto`, Camera and Photos sources, SwiftPM Camera product wiring, chooser invocation, save behavior, and permission errors.

## Validation boundary

- Linux can run the deterministic version contract, focused profile-photo tests, and the web app build.
- Xcode/macOS is required for Swift package resolution, simulator compilation, installation, launch, and actual native picker invocation.
- The current CI generic simulator build does not prove that the app reaches its initial screen.

## Runtime acceptance procedure

On macOS, build for a named simulator, install the app, launch bundle `ai.allplays.lite`, and capture evidence of the rendered initial screen. Seed a valid image with `simctl addmedia`, authenticate, open Profile, choose “Choose existing photo,” and confirm the Photos picker opens without a Camera plugin initialization error.

Recurrence risk is medium before the native contract and low afterward, with residual risk because launch/plugin initialization is not yet an automated CI interaction.

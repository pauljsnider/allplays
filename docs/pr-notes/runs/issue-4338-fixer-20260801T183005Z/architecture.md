# Architecture — Issue #4338

Bound to starting HEAD: `ed4cc306ab6bf965896e77d024828b703e61292b`

## Defect mechanism

- #4337 upgraded root Capacitor packages to `8.5.0` and Camera to `8.2.2` but excluded native resolution.
- Capacitor generates `CapApp-SPM/Package.swift` from the installed `@capacitor/ios` version. A clean `npm ci` must precede synchronization; stale installed modules would regenerate the old pin.
- The checked-in SwiftPM manifest and lock remained at `capacitor-swift-pm` `8.4.2`.
- Camera `8.2.2` also resolves `IONCameraLib` `1.0.5`, compared with the checked-in `1.0.4`.

## Minimal safe patch

1. Install locked root dependencies and run iOS synchronization.
2. Change the generated `Package.swift` runtime pin only from `8.4.2` to `8.5.0`, preserving local plugin declarations.
3. Refresh Xcode's `Package.resolved`. Expected package movement is Capacitor to `8.5.0` revision `4f71d0b979f2f957326f04353eca7604ee937e1e` and IONCameraLib to `1.0.5` revision `9068b2cc9584bfa118c185b8032bbebb3a4a2174`; inspect any broader drift before accepting it.
4. Add a deterministic test tying the native manifest and resolved pin to the version in the root lockfile.
5. Leave application and profile-photo workflow code unchanged because existing tests cover the correct adapter behavior.

## Dependency flow and blast radius

`package-lock @capacitor/ios` → `cap sync ios` → exact `capacitor-swift-pm` manifest → Xcode resolution/linking → native bridge and Camera plugin registration.

The runtime blast radius is limited to the iOS shell and linked native plugins. No Firebase, Android, web, data-model, authorization, or profile workflow behavior changes. Rollback must revert JavaScript and native runtime state together; reverting only native files recreates version skew.

## Verification

- Run the focused native config and profile-photo tests.
- Resolve Swift packages and build the Debug app for an iOS simulator.
- On a Mac, boot a named simulator, install and launch `ai.allplays.lite`, verify the initial screen, seed a test image, and invoke the Photos chooser from Profile.

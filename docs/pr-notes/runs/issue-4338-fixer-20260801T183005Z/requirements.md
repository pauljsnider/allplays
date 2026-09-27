# Requirements — Issue #4338

Bound to starting HEAD: `ed4cc306ab6bf965896e77d024828b703e61292b`

## Observed facts

- Dependency #4337 is closed and merged at this HEAD.
- JavaScript manifests and lockfiles resolve Capacitor runtime `8.5.0` and Camera `8.2.2`.
- `ios/App/CapApp-SPM/Package.swift` and the workspace `Package.resolved` still resolve `capacitor-swift-pm` `8.4.2`.
- The iOS package already includes `CapacitorCamera`, and iOS usage descriptions cover camera and photo-library access.
- The existing Profile flow offers “Take photo” and “Choose existing photo,” calls `Camera.getPhoto`, and has regression coverage for native capture and permission denial.
- Current native CI synchronizes, resolves, and builds for a generic simulator, but does not install or launch the app.

## Root cause and acceptance interpretation

The JavaScript dependency upgrade does not automatically refresh Capacitor's generated SwiftPM manifest or Xcode's resolved package pin. This leaves the JavaScript runtime at `8.5.0` while the native iOS bridge remains at `8.4.2`.

Acceptance requires:

- Synchronizing the existing iOS project without unrelated native changes.
- Requiring and resolving `capacitor-swift-pm` exactly at `8.5.0`, with no remaining native runtime `8.4.2` reference.
- Completing a Debug iOS simulator build with code signing disabled.
- Installing and launching the app in a booted simulator until an ALL PLAYS screen renders beyond the launch storyboard.
- Invoking the existing Profile → Account → Choose existing photo path without an unavailable, unimplemented, registration, or initialization error. Photo-library selection is the required simulator-supported path because camera hardware support varies.

## Assumptions and scope

- The existing profile-photo behavior is correct and must not be redesigned.
- Uploading or saving a replacement image is not required merely to prove plugin initialization.
- Android, Firebase SDKs, unrelated plugins, new camera capabilities, and profile-photo workflow changes are out of scope.

## Risks and evidence

- Mixed JS/native Capacitor versions can cause bridge or plugin-registration failures.
- A generic simulator build proves compilation but not WebView launch.
- Required evidence is a focused native-version regression, no stale iOS runtime reference, a successful simulator build, initial-screen launch evidence, and photo-picker invocation without a plugin initialization error.

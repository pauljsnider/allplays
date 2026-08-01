# Code plan — Issue #4338

Bound to starting HEAD/base: `ed4cc306ab6bf965896e77d024828b703e61292b`

## Observed state

- The worktree starts clean on `paulbot/fix/issue-4338-20260801183004`.
- Root locks resolve Capacitor `8.5.0` and Camera `8.2.2`; iOS SwiftPM files remain at Capacitor `8.4.2`.
- Installed root modules were stale, so synchronization must follow `npm ci`.
- Existing tests pass despite the native drift because CI repairs it ephemerally before building.

## Implementation sequence

1. Add the focused failing regression to `tests/unit/app-capacitor-native-config.test.js`, deriving the expected version from `package-lock.json` and checking both SwiftPM files.
2. Run the focused test and record the expected mismatch failure.
3. Run clean dependency installation, build the app bundle, and synchronize iOS.
4. Regenerate or reproduce Xcode-resolved SwiftPM state without inventing metadata. Review any pin beyond Capacitor and IONCameraLib before accepting it.
5. Run the native config regression and existing profile-photo tests.
6. Run the smallest available iOS build validation. If Xcode is unavailable, report that runtime launch and plugin invocation remain external acceptance evidence rather than claiming success.

## Failure recovery

- If the manifest stays at `8.4.2`, verify installed `@capacitor/ios` and rerun a clean install before sync.
- If SwiftPM caches an old resolution, use fresh cloned-source and DerivedData directories on macOS.
- Reject unexplained Firebase or unrelated package drift.
- Use the Photos path when simulator camera capture is unsupported.

## Synthesized decision

All roles agree on a three-part patch: native version contract, synchronized `Package.swift`, and refreshed `Package.resolved`. No role recommends profile application-code changes. The only unresolved acceptance evidence is macOS simulator launch and interactive Photos-picker invocation, which cannot be honestly produced on this Linux host.

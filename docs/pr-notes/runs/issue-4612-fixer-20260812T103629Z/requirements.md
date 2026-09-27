# Requirements

## Problem Statement

`@capacitor-firebase/app-check` remains exact-pinned at `8.3.0` across the root and React/Capacitor package artifacts even though `8.4.0` is available. Align every package surface without changing App Check behavior or user workflows.

## User Segments Impacted

- Coaches, parents, and admins must see no behavior change in protected workflows.
- Release operators must get deterministic root and app installs at `8.4.0`.

## Acceptance Criteria

1. Both manifests declare App Check exactly at `8.4.0`.
2. Both npm lockfiles and the app pnpm lockfile resolve App Check `8.4.0`.
3. A focused contract prevents partial manifest or lockfile updates.
4. The focused native-config contract and app build pass.
5. No other dependency or runtime behavior changes.

## Non-Goals

- Upgrade other dependencies.
- Change App Check configuration, initialization, enforcement, or native shell wiring.
- Run local Gradle, Xcode, Capacitor sync, or broad smoke suites.

## Edge Cases

- Root and app installs can drift if only one manifest or lockfile changes.
- The existing shared test assumes all four Capacitor Firebase plugins use one version, but only App Check is actionable.
- Lockfile regeneration can introduce unrelated dependency churn.

## Open Questions

None blocking.

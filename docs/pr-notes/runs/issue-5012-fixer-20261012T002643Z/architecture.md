# Architecture analysis

> Main-lane synthesis: the required `allplays-architecture-expert` skill was unavailable and every requested `sessions_spawn` role run failed before execution because the worker reported `published reply runtime missing for main`.

## Dependency boundary

`apps/app/package.json` and its npm lockfile form an independent package boundary, but several runtime dependencies are intentionally duplicated in the root package because Capacitor synchronization and cross-surface tests consume the root installation. The existing `app-capacitor-native-config` test codifies that shared versions remain identical.

## Minimal safe update design

1. Change only app-only direct dependency specifiers to the newest release in their current major.
2. Preserve caret specifiers and the existing exact pins.
3. Regenerate `apps/app/package-lock.json` from the edited app manifest with npm 10+ semantics and lifecycle scripts disabled.
4. Do not run Capacitor sync or edit Android/iOS manifests because no shared native runtime package is being advanced.
5. Keep security overrides for `brace-expansion`, `minimatch`, and `@grpc/grpc-js` unchanged and verify the generated lock still resolves them exclusively to the overridden versions.

## Coupled packages deferred

- Root/app shared packages, including Capacitor Firebase plugins, Capacitor plugins, Sentry, React, React DOM, React Router, jsdom, Testing Library React, Firebase, Vitest, web-vitals, and speech recognition, need a coordinated root-and-app maintenance slice.
- React type packages are left at the current 19.2 line because advancing them to 19.3 while the shared React runtime remains 19.2 would weaken runtime/type alignment.
- Major releases remain outside the issue's compatibility boundary.

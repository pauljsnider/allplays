# Requirements analysis

Baseline: `257b99bb38817e1fd5511710a5618d19ae48d7c3`.

## Acceptance interpretation

- Root and app manifests must declare the direct `web-vitals` dependency as `^6.0.1`.
- Root npm, app npm, and app pnpm lockfiles must resolve that direct dependency to `6.0.1`.
- The adapter must continue registering CLS, FCP, INP, LCP, and TTFB once and emitting the existing `app_web_vital` payload without fatal import failures.
- Metric names, destinations, sampling, thresholds, Firebase dependencies, and Capacitor dependencies are out of scope.

## Observed state and assumptions

- The runtime upgrade already landed in `73bd5e54` for root files and `82c020e2` for app files.
- Firebase Performance's nested `web-vitals@4.2.4` is an independent transitive dependency and is not direct-version drift.
- Existing adapter unit and performance smoke tests are the nearest behavior coverage, so no instrumentation source edit is justified.

## Guardrails and checks

- Do not regenerate lockfiles or edit `apps/app/src/`.
- Add a direct dependency alignment assertion spanning root and app manifests and npm lockfiles; retain the existing app pnpm assertion.
- Run the focused adapter unit test, dependency contract, app build, and focused performance smoke.

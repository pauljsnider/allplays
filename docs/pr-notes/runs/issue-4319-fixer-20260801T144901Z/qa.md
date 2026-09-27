# QA analysis

Baseline: `257b99bb38817e1fd5511710a5618d19ae48d7c3`.

## Failing invariant

The upgrade has already landed, but no single contract covers the direct `web-vitals` version across both root and app manifests and npm lockfiles. The existing app dependency contract already covers the app pnpm importer and package snapshot.

## Regression strategy

- Assert root and app manifest specifiers are `^6.0.1`.
- Assert root and app npm importers use `^6.0.1` and direct package entries resolve `6.0.1`.
- Preserve the existing app pnpm assertions for importer and package resolution.
- Do not reject Firebase's valid nested `4.2.4` resolution.
- Reuse `apps/app/src/lib/webVitals.test.ts` for all five callback registrations and telemetry behavior.

## Focused checks

Run the dependency contract, adapter and wiring tests, direct dependency tree checks, app build, and `tests/smoke/app-performance-timers.spec.js` against the Vite server. The browser smoke requires an installed Playwright Chromium binary.

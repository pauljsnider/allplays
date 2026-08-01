# Architecture analysis

Baseline: `257b99bb38817e1fd5511710a5618d19ae48d7c3`.

## Current state

The requested direct dependency upgrade is already on `master`: root files changed in `73bd5e54`, and app npm/pnpm files changed in `82c020e2`. Both scopes declare `^6.0.1` and resolve `6.0.1`. Firebase Performance legitimately retains its isolated transitive `4.2.4` resolution.

## Compatibility and patch

`apps/app/src/lib/webVitals.ts` still imports the stable v6 exports `onCLS`, `onFCP`, `onINP`, `onLCP`, and `onTTFB`. The minimal remaining patch is a test-only direct dependency contract. Runtime code and lockfiles must remain unchanged.

## Risk, rollback, and validation

- Runtime blast radius: none.
- Recurrence risk: grouped dependency automation can satisfy a splitter issue before the fixer lane begins.
- Rollback: revert the focused regression-test commit.
- Validate direct npm trees, focused unit tests, app build/import compatibility, and the focused browser smoke.

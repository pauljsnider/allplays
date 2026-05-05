# QA Notes

## Failing Check
- `unit-tests [ci]`
- `unit-tests [deploy-preview]`

## Root Cause Under Test
`tests/unit/live-tracker-retry-queue.test.js` expected pending finalization replay to clear `liveState.pendingFinish`. The replay instead failed with `hasConfiguredLiveStream is not defined`, so the queue persisted the pending finish with `lastError`.

## Validation Plan
1. Run affected live tracker retry queue test.
2. Run full unit suite because the same harness helper appears in multiple live tracker tests.

## Validation Executed
- `npm test -- --run tests/unit/live-tracker-retry-queue.test.js`
- Result: pass. The package script runs `vitest run tests/unit`, so this also exercised the full unit suite: 165 files, 755 tests passing.

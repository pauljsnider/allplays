# QA Role Notes

Thinking level: low.

## Validation targets
- `tests/unit/live-tracker-reset.test.js` should assert reset payload clears scores/stats.
- Pre-start clear logic should remove `liveEvents` docs along with other live data collections.

## Test plan
- Run targeted unit test: `npx vitest run tests/unit/live-tracker-reset.test.js`.
- If environment blocks execution, report limitation explicitly.

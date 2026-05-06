# QA Notes

## Failure
`tests/unit/track-live-baseball.test.js` asserts the baseball live tracker page contains both generic stats panel IDs and hides generic stat tables in baseball mode.

## Validation plan
1. Run the targeted unit test: `npx vitest run tests/unit/track-live-baseball.test.js`.
2. Run the full unit suite if targeted validation passes: `npm test -- --runInBand` is not applicable to Vitest, so use `npm test`.

## Expected result
The baseball wiring test passes and the broader unit suite remains green.

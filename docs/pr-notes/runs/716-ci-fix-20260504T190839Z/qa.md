# QA Notes

## Affected behavior
Only the unit-test expectation for Firestore scorekeeping access wiring is affected. The test should continue to prove scorekeeper writes are allowed for game score updates/events/stats and roster or schedule delete/write controls remain restricted.

## Validation
Run `npm test -- --run tests/unit/scorekeeping-access-wiring.test.js` for the focused failing area, then `npm test` if time permits.

## Pass criteria
The scorekeeping access wiring test passes locally and the full unit suite has no failures.

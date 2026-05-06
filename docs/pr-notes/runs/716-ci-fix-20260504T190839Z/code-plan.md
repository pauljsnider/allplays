# Code Plan

## Files to inspect/change
- Inspect: `firestore.rules`
- Change: `tests/unit/scorekeeping-access-wiring.test.js`

## Minimal patch
Replace the exact `allow update` string assertion with assertions that the rules include the owner/admin branch and the scoped scorekeeping update predicate. Leave Firestore rules unchanged.

## Validation command
`npm test -- --run tests/unit/scorekeeping-access-wiring.test.js`

## Commit message
`fix:address-ci-failure: update scorekeeping rules assertion`

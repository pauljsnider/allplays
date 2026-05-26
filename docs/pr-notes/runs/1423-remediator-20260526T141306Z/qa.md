# QA Plan

## Automated Checks
- Add a unit regression test for selected participant/guardian columns containing `0` and `false`.
- Run the focused Vitest file: `npx vitest run tests/unit/registration-review.test.js --reporter=verbose`.

## Manual Checks
- Not required for this pure CSV helper change.

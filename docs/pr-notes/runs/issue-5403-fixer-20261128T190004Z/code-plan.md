# Code Plan

## Current gap

The aggregate Functions verifier rejects missing authoritative target evidence, but the regression suite does not explicitly model a Firebase deploy that exits 0 while only some intended Functions complete.

## Minimal patch

Change only `tests/unit/verify-firebase-application-deployment.test.js` for executable behavior:

- add an exit-zero deployment result in the aggregate Functions describe block;
- reuse authoritative evidence helpers for a strict subset of expected targets;
- assert the exit-zero precondition;
- capture verification failure;
- assert `firebase-functions-incomplete-targets` and the omitted target.

No production script change is expected because dependency #5402 already enforces target completeness.

## Validation

Run `npx vitest run tests/unit/verify-firebase-application-deployment.test.js --reporter=verbose`.

## Recurrence risk

Medium: future gate code could incorrectly treat command success as production success.

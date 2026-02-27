# QA role output

## Test strategy
- Update `tests/unit/team-access.test.js` with a regression asserting stale `coachOf` alone does not grant full access.
- Run targeted unit test file first.
- Run full `tests/unit` suite after fix.

## Regression guardrails
- Verify owner/admin-email/platform-admin full access still passes.
- Verify parent limited access behavior remains unchanged.

## Residual risk
- Firestore rules are not covered by emulator tests in this repo; manual validation in a staging Firebase project is still recommended.

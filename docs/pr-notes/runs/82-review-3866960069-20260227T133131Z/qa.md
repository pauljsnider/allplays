# QA Role Summary

## Test Strategy
- Unit: verify admin invite flow writes `adminEmails` when absent.
- Unit: verify no write when email already present (case-insensitive).
- Regression: verify code consumption call still occurs.

## Commands
- `./node_modules/.bin/vitest run tests/unit/accept-invite-flow.test.js`
- `./node_modules/.bin/vitest run tests/unit`

## Acceptance Criteria
- All invite-flow unit tests pass.
- Full unit suite remains green.

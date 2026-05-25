# QA notes

## Validation scope
Run the affected parity unit test first, then the full unit suite because CI failure is in the unit-tests job.

## Commands
- `npx vitest run tests/unit/app-auth-profile-capabilities.test.js --reporter=verbose`
- `npm test`

## Expected result
All profile capability parity assertions pass, including invite code/link coverage. Full unit suite remains green.

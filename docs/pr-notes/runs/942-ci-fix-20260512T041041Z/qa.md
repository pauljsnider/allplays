# QA Notes

## QA Plan
- Run the targeted failing Vitest file: `npx vitest run tests/unit/admin-invite-signup-cache-busting.test.js`.
- Run the adjacent accept-invite page tests: `npx vitest run tests/unit/accept-invite-page.test.js tests/unit/admin-invite-signup-cache-busting.test.js`.
- If time allows, run full unit suite via `npm test`.

## Expected Evidence
- Targeted test passes and confirms cache-busting import assertions match current source.

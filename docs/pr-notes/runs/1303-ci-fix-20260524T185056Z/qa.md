# QA notes

Subagents were unavailable in this environment, so this role analysis was completed inline.

Validation target: Home smoke URLs should resolve through `SMOKE_APP_BASE_URL || baseURL`, matching `app-teams.spec.js`. This restores the module-route mocks and expected app shell route for `/home`, `/teams`, and desktop Home workspace cases.

Executed:
- `npm run app:build` passed.
- `npx vitest run tests/unit/app-home-player-integration.test.jsx tests/unit/app-home-logic.test.js --reporter=verbose` passed, 9 tests.
- Targeted Playwright smoke command was attempted, but local browser binaries are missing: Chromium headless shell not installed. CI has the browser dependency, so this is a local environment blocker, not a test assertion failure.

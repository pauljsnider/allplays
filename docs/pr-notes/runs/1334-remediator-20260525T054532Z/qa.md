# QA notes

Subagent role spawning was unavailable in this environment, so this note captures inline QA analysis.

## Regression coverage
- Add a unit test that mocks an online-checkout registration returned by `loadParentRegistrations`.
- Assert the route renders an unavailable/error message and never calls `submitOfflineRegistration`.

## Validation command
- `npx vitest run tests/unit/app-registration-detail.test.jsx --reporter=verbose`

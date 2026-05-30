# QA Plan

- Add a unit regression for a recipient with prior payment where a new payment is less than outstanding balance.
- Run targeted Vitest file: `npx vitest run tests/unit/app-team-fees-service.test.ts --reporter=verbose`.
- Run app build if feasible via repository validation command `npm run app:build`.

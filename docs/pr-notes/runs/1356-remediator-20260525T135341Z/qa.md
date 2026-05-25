# QA

## QA Plan
- Run focused unit coverage for app search integration and service behavior: `npx vitest run tests/unit/app-search-integration.test.jsx tests/unit/app-search-service.test.js --reporter=verbose`.
- Run a focused app build/typecheck if feasible: `npm run app:build`.
- Regression condition: a smoke-style JS mock may omit `help`; opening search must still render and no runtime error should occur.

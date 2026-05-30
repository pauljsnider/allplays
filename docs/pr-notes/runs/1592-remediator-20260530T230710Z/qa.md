# QA

Regression coverage:
- Seed mixed parent/coach help results.
- Select Parent and assert coach-only help is hidden while parent help remains.
- Press Enter and assert navigation opens the parent help article, proving keyboard navigation uses the filtered result set.
- Select Member and assert no help articles are shown with the no-match status.

Validation commands:
- `npx vitest run tests/unit/app-search-integration.test.jsx --reporter=verbose`
- `npm run app:build`

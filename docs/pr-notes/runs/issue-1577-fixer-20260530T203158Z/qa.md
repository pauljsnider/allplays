# QA Plan

## Automated Coverage
- Update `tests/unit/app-search-integration.test.jsx` to verify the Help role filter renders All, Parent, Coach, Admin, Member.
- Verify All is selected by default.
- Verify selecting Parent/Member updates `aria-pressed` state.
- Verify help results remain rendered after role changes, proving no backend/result filtering was added.
- Verify search input remains present and unaffected.

## Validation Commands
- `npx vitest run tests/unit/app-search-integration.test.jsx --reporter=dot`
- `npm run app:build`

## Manual Checks
- Open search on mobile width and confirm chips wrap/fit near the Help section.
- Switch chips and confirm selected styling changes.
- Confirm Enter/Escape and result navigation still work.

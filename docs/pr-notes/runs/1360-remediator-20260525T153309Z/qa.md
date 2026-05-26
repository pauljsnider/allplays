# QA Plan

Automated coverage:

- `tests/unit/auth-parent-membership-sync.test.js` verifies legacy `checkAuth` hydrates both upload-grant arrays and `canContributeTeamMedia` allows only granted teams.
- `tests/unit/app-auth-profile-capabilities.test.js` verifies app auth user typing and hydration preserve both fields with string filtering.
- Existing team media utility and rules tests continue to cover parent-only denial, grant allowance, and backend rule parity.

Validation commands:

- `npx vitest run tests/unit/auth-parent-membership-sync.test.js tests/unit/app-auth-profile-capabilities.test.js tests/unit/team-media-utils.test.js tests/unit/team-media-page.test.js tests/unit/team-media-wiring.test.js tests/unit/team-media-item-rename.test.js --reporter=verbose`
- `npm run app:build`
- `npm run test:unit:ci`

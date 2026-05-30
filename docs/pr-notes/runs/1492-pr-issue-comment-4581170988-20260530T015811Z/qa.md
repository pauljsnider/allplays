# QA Plan

## Automated Coverage
- `tests/unit/app-search-service.test.js`
  - Active private fallback appears after canonical doc validation.
  - Archived, inactive, and missing-doc fallback teams are excluded.
  - Existing site-list team merge remains non-duplicating.
  - Cache/fallback tests mock required visibility reads.
- Existing coverage retained for `team-visibility` and app schedule service contracts.

## Validation Commands
- `npx vitest run tests/unit/app-search-service.test.js --reporter=verbose`
- `npx vitest run tests/unit/team-visibility.test.js tests/unit/app-search-service.test.js tests/unit/app-schedule-service-contracts.test.js --reporter=verbose`
- `npm run app:build`

## Manual Smoke Recommendation
Use a parent account linked to one active private team and one archived/inactive team. Confirm app search shows only the active private team and player search only returns players from visible teams.

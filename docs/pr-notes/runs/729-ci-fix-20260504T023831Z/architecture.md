# Architecture Notes

## Acceptance Criteria
- Team page smoke stubs must satisfy the current `team.html` module contract.
- The schedule rendering path should execute far enough to populate `#team-header` and `#schedule-list`.
- No production behavior changes are needed for this CI-only failure.

## Architecture Decisions
- Root cause is test fixture drift: `team.html` now imports `getAdSpaceSponsors` from `js/db.js?v=76`, but the Playwright smoke stub for `js/db.js` does not export it.
- Keep fix scoped to the smoke test fixture rather than adding defensive production code, because production `js/db.js` already exports `getAdSpaceSponsors`.

## Risks And Rollback
- Risk is limited to smoke tests. Rollback by removing the added stub export if the production import contract changes again.

# Architecture Notes

## Acceptance Criteria
- Preview smoke tests for `team.html` load the page module successfully.
- Calendar schedule smoke tests continue to validate practice-only and filter-bucket behavior.
- No production behavior or data model changes.

## Architecture Decisions
- Root cause: `team.html` imports new RSVP helpers from `js/db.js?v=76`, while the smoke test DB module stub did not export them. ES module import resolution failed before `loadTeam()` rendered the header or schedule.
- Minimal fix: align the smoke stub export surface with `team.html` by adding neutral test exports for `getRsvpSummaries`, `submitRsvp`, and `getMyRsvp`.

## Risks And Rollback
- Risk is isolated to test harness behavior. Production code and Firestore access controls are untouched.
- Rollback is reverting the test stub additions if the page import contract changes again.

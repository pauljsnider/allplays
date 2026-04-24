# Requirements

## Objective
Keep PR #597's tournament pool ranking override feature intact while restoring the existing edit-schedule calendar import experience and preview-smoke stability.

## User Outcomes
- Admins can still review and save final tournament pool rankings.
- Coaches still see imported schedule rows on edit-schedule.
- Cancelled imported rows remain visible, but Track and Plan Practice actions stay hidden when they should.

## Acceptance Criteria
- `edit-schedule.html` can import `saveTournamentPoolOverride` and `clearTournamentPoolOverride` without breaking smoke-test stubs.
- Imported practice rows still render with planning context in the edit-schedule flow.
- Cancelled imported rows still render as cancelled and do not expose Track or Plan Practice actions.
- Smoke fixtures remain resilient to cache-bust query changes on `js/db.js`.

## Risks
- Test-only fix could mask a real runtime regression if the production page is actually broken. Counterevidence: unit tests pass and the smoke failures line up with missing stub exports plus an exact `db.js?v=20` route.
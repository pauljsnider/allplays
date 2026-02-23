# QA Role Notes (League Link + Standings)

## Objective
Validate that league URL persistence and standings extraction work and do not regress core team page behavior.

## Automated Validation
- `./node_modules/.bin/vitest run tests/unit/league-standings.test.js`
- `./node_modules/.bin/vitest run tests/unit/live-tracker-notes.test.js tests/unit/drills-issue28-helpers.test.js`
- `./node_modules/.bin/vitest run tests/unit/*.test.js` (14 tests passed)
- `node --check js/league-standings.js`

## Manual Validation Checklist
1. Open `edit-team.html` for an existing team, set `League Link`, save, reload, and confirm field persists.
2. Open `team.html` for that team and confirm:
   - header shows `League Page` link.
   - season overview shows `League Standings` card with W/L-based record.
3. Remove league link and confirm graceful fallback (`No league link configured`).

## Residual Risk
- Third-party markup changes in TeamSideline can break parser assumptions.
- Browser CORS/proxy variability may occasionally block standings fetch.

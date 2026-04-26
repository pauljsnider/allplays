# QA Role Artifact

## Risk Matrix
- High: valid division-scoped advancement silently skips because no eligible seeds are found.
- Medium: same pool name across divisions could cross-populate incorrect bracket slots.
- Low: legacy unscoped pool advancement could regress.

## Automated Coverage
- Add regression in `tests/unit/tournament-brackets.test.js` where `divisionName` lives on `game.tournament` and `poolName`/`seed` live on slot assignments.
- Assert `collectTournamentPoolSeeds(games, '10U Gold • Pool A')` returns only the matching division seeds.
- Assert `planTournamentPoolAdvancement` resolves the matching bracket game and does not update the other division.
- Keep existing tests for legacy pool advancement, missing rankings, overwrite previews, and saved-resolution stability.

## Commands
- `npx vitest run tests/unit/tournament-brackets.test.js`
- `npx vitest run tests/unit/tournament-brackets.test.js tests/unit/tournament-standings.test.js tests/unit/edit-schedule-tournament.test.js`
- `npm run test:unit:ci`

## Manual Checks
- In schedule editor, create two divisions sharing `Pool A`, configure pool-seed bracket slots, finalize one division, advance, confirm preview and saved bracket slots only affect that division.

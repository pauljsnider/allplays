# Code Plan

## Likely Fault Location
`edit-schedule.html` game save flow where `counterpartTeamId` is resolved after `updateGame`/`addGame`.

## Minimal Patch Plan
- Remove fallback to `gamesCache[editingGameId]` when computing `counterpartTeamId`.
- Use `gameData.opponentTeamId` so notification routing matches the submitted link state.
- Add a unit assertion covering the new routing source.

## Test Updates
- Extend `tests/unit/edit-schedule-notifications.test.js` to assert counterpart targeting uses submitted form data and no stale shared-schedule fallback remains.

## Validation Commands
- `npm test -- edit-schedule-notifications.test.js`
- `git diff --stat`

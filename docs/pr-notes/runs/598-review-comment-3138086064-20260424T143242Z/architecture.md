# Architecture

## Current State
`handleAdvanceTournamentPool()` builds its planner input from `gamesCache`, but `gamesCache` is filled inside `renderDbGame()`. Because rendering happens after schedule filtering, that cache only contains the subset currently shown on screen.

## Proposed State
Introduce a separate `allTeamGamesCache` that is populated from DB game records during `loadSchedule()` before view filtering. Keep `gamesCache` for rendered-row UI actions, and use `allTeamGamesCache` for pool advancement planning and patch application.

## Blast Radius
- Primary file: `edit-schedule.html`
- Test touch: `tests/unit/edit-schedule-tournament.test.js`
- No schema, rule, or backend changes

## Controls
- Preserve existing rendered-row behavior by leaving `gamesCache` in place.
- Restrict the new cache to non-practice DB games only.
- Rollback is a single commit revert.

## Recommendation
Use dual caches. It is the smallest design change that restores correct bracket propagation without disturbing schedule filtering behavior.
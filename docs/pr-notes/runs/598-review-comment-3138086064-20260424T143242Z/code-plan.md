# Code Plan

## Root Cause
Pool advancement used `gamesCache`, which only contains DB games that survived the current schedule filter and were rendered. Downstream bracket games outside the current filter were absent from the planner input.

## Minimal Patch
1. Add `allTeamGamesCache` as a full DB-game cache populated during `loadSchedule()`.
2. Keep `gamesCache` for rendered-row interactions.
3. Change `handleAdvanceTournamentPool()` to read planning/apply input from `allTeamGamesCache`.
4. Add a targeted unit test assertion that the advancement flow uses the full-team cache.

## Impacted Files
- `edit-schedule.html`
- `tests/unit/edit-schedule-tournament.test.js`
- `docs/pr-notes/runs/598-review-comment-3138086064-20260424T143242Z/*.md`

## Caveats
- The full cache must only include DB games, not practices.
- Keep the rendered cache because other page actions are intentionally scoped to visible rows.

## Conflict Resolution
Requirements, architecture, QA, and code lenses all point to the same answer: separate full planning data from filtered rendering data instead of changing the tournament planner itself.
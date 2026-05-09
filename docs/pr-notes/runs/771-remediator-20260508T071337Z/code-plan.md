# Code plan

- Subagent spawn was unavailable in this environment, so inline code planning was used.
- Add sortSubstitutionPeriods helper in js/game-day-periods.js.
- Import it in game-day.html and sort Object.keys(state.rotationPlan) in getGameDayPeriods().
- Add a focused unit test for non-chronological persisted interval keys.
- Run targeted vitest coverage and commit.

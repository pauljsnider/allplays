Current state
- `buildLineupPublishPayload()` persists flattened lineup keys.
- `buildRotationPlanFromGamePlan()` rebuilds nested period-to-position assignments.
- `game-day.html` keeps separate active-period state for Pre-Game and Game Day views.

Observed gap
- Reloaded 4-period lineups can restore data correctly while still rendering an empty first Game Day view because `activePeriodGD` defaults to `H1`.

Proposed change
- Add a small period helper module:
  - derive period labels from `numPeriods`
  - normalize an active period against the allowed periods
- Use that helper in `game-day.html` when rendering Game Day period tabs.
- Add a regression test that round-trips a published basketball lineup and asserts visible-period normalization.

Why this path
- Minimal blast radius.
- Testable with existing Vitest coverage.
- No schema change and no dependency on browser automation.

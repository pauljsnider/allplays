# Architecture role synthesis (fallback)

Current state:
- `expandRecurrence` iterates day-by-day and matches weekly occurrences solely by weekday membership.
- Weekly interval is stored but never used for match gating.

Proposed state:
- Keep day-by-day iteration to avoid broad refactor.
- Add weekly interval gate based on elapsed whole weeks from `seriesStart`.
- A candidate weekly date matches only if:
  - Day-of-week matches current weekly rules, and
  - `weeksSinceSeriesStart % interval === 0`.

Risk and blast radius:
- Scope limited to `js/utils.js` recurrence expansion used by schedule, calendar, parent dashboard.
- Main risk is off-by-one around week boundaries; mitigate with targeted unit tests.

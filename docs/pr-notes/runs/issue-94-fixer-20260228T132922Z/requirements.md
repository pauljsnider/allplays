# Requirements role synthesis (fallback)

Objective: Ensure weekly recurring practices honor `recurrence.interval` so `interval = N` generates every N weeks, not every week.

User impact:
- Coaches creating biweekly or multi-week recurring practices currently get extra events.
- Parents and team dashboards inherit these incorrect occurrences.

Acceptance criteria:
- Weekly series with `byDays` and `interval > 1` only produces occurrences on weeks aligned to the master start week cadence.
- Weekly series without `byDays` still defaults to the master day-of-week, respecting interval.
- Existing daily recurrence behavior remains unchanged.
- `count` and `until` still cap occurrences.

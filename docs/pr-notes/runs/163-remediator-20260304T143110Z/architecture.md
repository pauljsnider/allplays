# Architecture role notes

- Current state:
  - `expandRecurrence` iterates day-by-day.
  - Cursor may jump from `seriesStart` to `windowStart` for performance.
  - Weekly cadence is anchored to `seriesStartWeekStartDayNumber`.
  - Iteration cap is derived from `windowDays` and computed span.
- Risk surface:
  - Fast-forwarded cursors can be off cadence for interval-weekly schedules unless explicitly re-aligned.
  - Iteration cap mis-sizing can silently drop occurrences.
- Proposed state:
  - Keep day-by-day strategy, but when fast-forwarding weekly schedules, align cursor to the next interval-matching week based on the original series anchor.
  - Set iteration cap to traversal days plus a fixed safety buffer so it cannot underflow the day-by-day loop.
- Blast radius:
  - Confined to recurrence expansion behavior and related recurrence unit tests.

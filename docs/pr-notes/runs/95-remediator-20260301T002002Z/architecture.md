# Architecture Role Analysis (manual fallback)

## Current State
`expandRecurrence` iterates day-by-day and applies recurrence gates. Prior review concerns were:
- timezone-misaligned day-number derivation,
- weekly interval bucket alignment using start-anchored 7-day blocks.

## Proposed State
- Use epoch-based day numbers via `Math.floor(date.getTime() / MS_PER_DAY)` consistently for `seriesStart` and `current`.
- Derive week buckets from week-start day numbers:
  - `seriesWeekStartDayNumber = seriesStartDayNumber - seriesStart.getDay()`
  - `currentWeekStartDayNumber = currentDayNumber - current.getDay()`
  - `weeksSinceSeriesStart = floor((currentWeekStartDayNumber - seriesWeekStartDayNumber) / 7)`

## Blast Radius
Low. Changes are isolated to recurrence matching math in `js/utils.js`.
No schema, auth, network, or storage changes.

## Controls
- Unit tests for daily and weekly interval guardrails.
- Regression assertion for biweekly Wednesday/Monday scenario from review thread.

## Rollback
Revert `js/utils.js` recurrence math and related test additions in one commit if regression is detected.

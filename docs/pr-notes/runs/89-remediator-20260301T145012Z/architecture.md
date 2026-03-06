# Architecture Role Notes

## Current state
`expandRecurrence` iterates day-by-day and determines inclusion by frequency-specific matching.

## Decision
Keep day-by-day iteration; enforce interval behavior entirely in match predicates:
- Daily: `daysSinceSeriesStart % interval === 0`.
- Weekly: compute week bucket from calendar week start (not start-date / 7 bucketing).

## Risk surface
- Recurrence generation only (`js/utils.js`).
- Blast radius: schedule expansion and any UI using occurrence instances.

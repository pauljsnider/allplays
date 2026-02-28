# Requirements Role Notes

## Objective
Prevent off-cadence weekly recurrence instances by aligning interval gating to a consistent calendar week boundary.

## Current vs Proposed
- Current: Weekly interval uses UTC day-number buckets but local weekday extraction (`getDay`), which can drift at timezone edges.
- Proposed: Use UTC weekday extraction (`getUTCDay`) everywhere recurrence week bucketing/day matching is computed.

## Risk Surface / Blast Radius
- Affects recurring practice expansion logic in `js/utils.js` only.
- No schema or API changes.
- Potential regression risk: existing weekly recurrences near timezone boundaries.

## Assumptions
- Recurrence dates are represented/compared in ISO UTC day form (`YYYY-MM-DD`).
- Week cadence should be deterministic regardless of client locale/timezone.

## Success Criteria
- Biweekly schedule starting `2026-03-04` with `byDays=['MO','WE']` excludes `2026-03-09`.
- Weekly interval outputs remain stable under different `TZ` values.

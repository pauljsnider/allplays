# Requirements Role (Fallback Synthesis)

## Tooling status
Requested skill `allplays-requirements-expert` and `sessions_spawn` are not available in this runtime; this file records equivalent requirements analysis.

## Objective
Fix timezone inconsistency in recurrence week-offset calculations so weekly interval matching is deterministic across local timezone/DST boundaries.

## Decision
Use a single time basis for series and current day-number math by switching both calculations from `Date.UTC(...)` to `date.getTime() / MS_PER_DAY`.

## Constraints and controls
- Keep behavior unchanged for daily recurrence and `byDays` matching.
- Limit blast radius to recurrence expansion internals.
- Preserve existing API and object shape.

## Acceptance criteria
- `expandRecurrence()` computes `weeksSinceSeriesStart` from consistent day-number derivation for both dates.
- No additional timezone conversion logic is introduced.
- Existing recurrence paths continue functioning.

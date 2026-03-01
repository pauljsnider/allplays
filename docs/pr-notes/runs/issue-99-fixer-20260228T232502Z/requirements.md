# Requirements Role (allplays-requirements-expert)

## Objective
Ensure recurring practices with end condition `until` include the final calendar date selected by the coach.

## Current vs Proposed
- Current: `until` is treated as midnight boundary; occurrences later that day are excluded.
- Proposed: `until` is treated as inclusive by calendar day so all occurrences on that date appear.

## User Impact
- Coach, parent, and team manager expect an `Ends on` date to include that date.
- Missing final occurrence causes planning, attendance, and trust issues.

## Acceptance Criteria
1. Daily recurrence starting `2026-03-01T18:00` with `until=2026-03-03` yields occurrences on `2026-03-01`, `2026-03-02`, and `2026-03-03`.
2. Behavior remains unchanged for series without `until`.
3. Behavior remains unchanged for exclusion dates and overrides.

## Risks
- Timezone edge cases around date parsing and local offsets.
- Potential regression for existing recurrence expansion logic.

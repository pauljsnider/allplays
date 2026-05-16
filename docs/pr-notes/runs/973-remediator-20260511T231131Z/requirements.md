# Requirements

## Acceptance Criteria
- Venue availability creation writes only expected scheduling-control fields plus server-managed timestamps.
- Organization blackout creation writes only expected blackout fields plus fixed `scope: 'organization'` and timestamps.
- Venue blackout creation writes only expected blackout fields plus fixed `scope: 'venue'` and timestamps.
- Venue availability and blackout submit handlers do not write when schedule initialization is blocked due to missing team, insufficient access, or an organization grouping with fewer than two teams.

## Assumptions
- Existing payload builder validation remains the source of field-level value validation.
- This remediation is scoped to review feedback only, with no broader schedule-control redesign.

# Requirements Role - Issue #104

## Objective
Ensure parent RSVP actions apply only to the intended child context, not all siblings on the same team.

## Current State
`submitGameRsvp` derives `playerIds` from all schedule entries on the same `teamId`, ignoring which row/button was clicked.

## Proposed State
RSVP submission must use explicit child scope from the clicked row:
- Single child row: one `childId`
- Multi-child aggregate row (calendar/day view): only child IDs attached to that event instance
- Never team-wide by default

## UX/Behavior Requirements
- A parent can RSVP one child without overwriting sibling availability.
- UI filtering by child remains consistent with RSVP behavior.
- Existing aggregate views continue to work but only for children shown on that event.

## Risk Surface / Blast Radius
- Area: `parent-dashboard.html` RSVP button wiring and submit handler.
- Data impact: `playerIds` persisted in game RSVP docs.
- Blast radius: parent RSVP flow only; no coach/admin edit flow changes.

## Assumptions
- Event rows already carry child identity (`childId` or equivalent derivable IDs).
- Backend `submitRsvp` behavior is correct if payload contains correct `playerIds`.
- Existing summary calculations should remain unchanged.

## Success Criteria
- Clicking RSVP on child A writes only child A in `playerIds`.
- Sibling rows are not overwritten unless explicitly included in clicked context.
- Regression test covers this and passes.

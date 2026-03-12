# Requirements Role (allplays-requirements-expert)

## Objective
Ensure cancelled external ICS events do not appear as active upcoming events in the global calendar.

## Current vs Proposed
- Current: synced ICS events can lose cancellation intent in the calendar UI, making cancelled activities look active.
- Proposed: global calendar keeps cancelled status for imported ICS events and renders them with clear cancelled affordances.

## User Impact
- Coaches and parents rely on the aggregated calendar as the source of truth for whether a game or practice is still on.
- A cancelled event shown as active is a schedule-trust failure with immediate real-world impact.

## Acceptance Criteria
1. ICS events marked `STATUS:CANCELLED` or prefixed with `[CANCELED]` or `[CANCELLED]` resolve to `status: 'cancelled'` in global calendar mapping.
2. Cancelled synced events render as visibly cancelled in detailed, compact, and day-detail calendar surfaces.
3. Non-cancelled synced ICS events remain unchanged.

## Risks
- Over-matching event titles that happen to contain cancellation text but are not actually cancelled.
- Browser cache serving stale `utils.js` if the import version is not bumped where needed.

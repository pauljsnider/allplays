# Requirements Role - Issue #147

## Objective
Ensure cancelled ICS events are treated as cancelled in calendar view so users do not see active workflows (including RSVP) for cancelled events.

## Current vs Proposed
- Current: Calendar imports ICS events and forces `status: 'scheduled'`.
- Proposed: Calendar preserves ICS cancellation signal (`STATUS:CANCELLED` and `[CANCELED]` prefix) by mapping affected events to `status: 'cancelled'`.

## User-Critical Outcomes
- Cancelled ICS events are visually marked and excluded from active event workflows.
- Users no longer act on false upcoming events.

## Risk Surface / Blast Radius
- Risk: Incorrect over-cancellation if summary parsing is too broad.
- Blast radius: `calendar.html` ICS event mapping path only.

## Assumptions
- `parseICS` continues to expose `event.status` from ICS payload.
- Existing calendar UI behavior for `ev.status === 'cancelled'` is already correct.
- TeamSnap-style prefix `[CANCELED]` should remain supported.

## Recommendation
Implement targeted status normalization during ICS-to-calendar event mapping and add a regression test that guards against reintroducing hardcoded scheduled status for ICS imports.

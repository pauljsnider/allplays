# Requirements Role (fallback in-process synthesis)

## Objective
Ensure recurring practice occurrences keep accurate RSVP totals after page reload for all authorized users.

## User-visible acceptance criteria
- If an RSVP exists for a recurring occurrence ID (`masterId__YYYY-MM-DD`), summary displays non-empty counts after refresh.
- Behavior is consistent in both Calendar and Parent Dashboard views.
- Existing non-recurring game/practice RSVP summary behavior is unchanged.

## Constraints
- Minimize blast radius: targeted fix to RSVP summary hydration path.
- Preserve current permissions model; do not require broader access than current reads.

## Conflict resolution
- Prefer deterministic recomputation from RSVP subcollection when denormalized game doc summary is unavailable.
- Keep UI rendering contract unchanged (`rsvpSummary` object shape).

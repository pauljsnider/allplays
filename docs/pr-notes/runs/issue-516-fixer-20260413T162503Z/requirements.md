# Issue #516 Requirements Synthesis

## Acceptance Criteria
- Count RSVP state per player, not per RSVP document.
- A coach override for one child replaces only that child's earlier parent response.
- Siblings covered by the same parent multi-player RSVP keep their prior effective response.
- Newer writes win per player, regardless of whether they came from a parent multi-player RSVP or a coach single-player override.
- Parent, calendar, team, and game-day views must stay aligned on effective counts.

## Edge Cases
- Parent RSVP covers `p1` and `p2`, then coach overrides only `p1`.
- Coach override for `p1`, then parent later re-submits a newer multi-player RSVP for `p1` and `p2`.
- Multi-player parent RSVP docs must not be deleted when overriding one child.

## Recommended Scope
- Add regression coverage for parent multi-player RSVP plus coach single-player override precedence.
- Keep the precedence model as latest-write-wins per player.
- Keep the patch targeted to RSVP precedence logic and regression protection.

# Requirements role (fallback synthesis)

## Objective
Prevent parent RSVP submissions for one child from overwriting sibling RSVPs on the same event, while keeping coach counts accurate.

## Current state
- Parent dashboard buttons are child-specific (`data-child-id`).
- Parent submission path writes RSVP docs keyed by `userId` only in `submitRsvp`.
- Hydration reads one `myRsvp` by `userId` and applies it to all child rows for that event.

## Proposed state
- Parent dashboard writes child-specific RSVP docs (`uid__playerId`) using the existing per-player RSVP API.
- Parent dashboard hydrates RSVP UI per child from event RSVP docs belonging to the current parent.
- Existing summary hydration remains intact.

## Constraints
- Keep patch minimal and local to parent RSVP flow.
- Preserve Firestore rules compatibility (already supports `uid__playerId`).
- Avoid changing unrelated calendar/team coach flows.

## Success criteria
- Parent can set different RSVP responses for siblings on same event and both persist.
- Re-opening parent dashboard shows each child’s own response.
- RSVP summary counts reflect both children independently.

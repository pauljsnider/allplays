Thinking level: low
Reason: the change is localized to one HTML template and one pure helper module.

Current state:
- RSVP action buttons depend on DOM traversal through a Tailwind spacing class.
- Player resolution already uses a local `Map`, but the implementation performs a redundant lookup.

Target state:
- RSVP buttons resolve the child selector from a semantic container attribute on the same rendered block.
- Player resolution performs one `Map.get(teamId)` and derives allowed IDs from the normalized array.

Blast radius comparison:
- Before: UI class rename could silently break parent RSVP submission.
- After: selector is anchored to a semantic attribute owned by the RSVP component, reducing accidental breakage during styling updates.

Rollback:
- Revert this single commit if the RSVP block render or submission flow regresses.

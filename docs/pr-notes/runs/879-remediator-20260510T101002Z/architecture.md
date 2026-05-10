# Architecture

- Root cause is in the parent dashboard RSVP controller local-state update: the single-child path exits before applying `rsvpSummary` to sibling event rows for the same team/game.
- Preserve per-child `myRsvp` isolation by updating `myRsvp` only for affected player IDs.
- Apply the aggregate summary separately to all matching team/game events because summary is game-level, not child-level.
- This keeps merged calendar entries, day modal cards, and list rows consistent after rerender without additional network reads.

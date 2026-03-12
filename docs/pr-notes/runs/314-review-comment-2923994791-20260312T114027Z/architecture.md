## Architecture role

- Smallest viable change: extract the game-doc to persisted-clock-state mapping into a shared helper in `js/live-tracker-resume.js`.
- Why: one code path for production and tests removes the string-assertion gap and makes the live tracker resume contract explicit.
- Blast radius comparison:
  - Current: inline object literal in `live-tracker.js`, easy to regress silently.
  - Proposed: shared helper used by caller and tests, same persisted fields, narrower regression surface.
- Rollback: revert helper usage and restore inline object literal if unexpected behavior appears.

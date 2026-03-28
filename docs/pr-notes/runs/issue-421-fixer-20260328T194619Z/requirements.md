# Requirements synthesis

- Objective: prevent removed opponent player cards from reappearing after a live tracker resume.
- Current state: opponent delete mutates `state.opp` and re-renders, but does not persist the filtered opponent set back to `game.opponentStats`.
- Proposed state: removing an opponent card must trigger the same persistence and `liveHasData` scheduling used by opponent edits and stat changes.
- Blast radius: limited to live tracker opponent card deletion and the persisted `opponentStats` payload on the game doc.
- Assumptions:
  - The intended behavior is that a removed opponent remains removed across reload/resume.
  - Existing resume hydration from `game.opponentStats` is correct when the stored payload is correct.
- Recommendation: add regression coverage on the delete interaction and patch only the delete handler.
- Success measure: automated test fails before the patch, passes after the patch, and the persisted snapshot excludes the removed opponent entry.

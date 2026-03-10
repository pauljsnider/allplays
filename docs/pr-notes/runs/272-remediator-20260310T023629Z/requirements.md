Objective: remediate the two unresolved PR review comments on finalized-game insight generation.

Current state: `js/post-game-insights.js` reads scoring and opponent flags from `event.undoData`.
Proposed state: the insight helpers read persisted top-level event fields first and fall back to `undoData` for compatibility with in-memory/live event objects.

Risk surface: limited to post-game insight text generation for completed games. Blast radius is low because only helper reads change and no write paths are touched.

Assumptions:
- Finalized game events are persisted with top-level `statKey`, `value`, and `isOpponent`.
- Existing callers may still pass in-memory events with `undoData`.

Recommendation: patch the helper accessors only. This addresses both review findings with the smallest control-preserving change.

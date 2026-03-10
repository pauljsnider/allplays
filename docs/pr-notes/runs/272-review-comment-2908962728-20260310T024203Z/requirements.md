## Requirements role summary

- Objective: ensure post-game insights continue to detect late scoring swings and closing-player moments from completed-game events saved with top-level `statKey`/`value` fields.
- Current state: the PR head implementation already reads persisted top-level fields, but regression coverage only exercised `undoData` fixtures.
- Proposed state: preserve the shipped implementation and add focused tests that fail if completed-game persisted scoring fields stop being recognized.
- Risk surface: low. Test-only change. No production behavior change.
- Acceptance criteria:
  - `generateGameInsights(...)` still emits late-game swing insights when completed-game scoring events use top-level `statKey`/`value` and opponent possession uses top-level `isOpponent`.
  - `generatePlayerGameInsights(...)` still emits closing-presence insights from the same persisted event shape.

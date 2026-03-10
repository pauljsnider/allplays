## Code role summary

- Constraint: required orchestration skills and `sessions_spawn` tool were not exposed in this session, so role outputs were captured directly in run-scoped notes.
- Change made: updated `tests/unit/post-game-insights.test.js` fixtures to use persisted top-level event fields for the scoring paths called out in review feedback.
- Rationale: the implementation fix is already present on the branch; tests now pin that contract so future edits cannot silently regress it.

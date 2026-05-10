# QA Plan

Validation:
- Run unit tests if available for affected helpers.
- Inspect Storage rules for scoped team-media access and fallback path coverage.
- Manual test targets: team member can open uploaded team media photo; unrelated signed-in user cannot open team media object; signed-in fallback upload succeeds for `stat-sheets/**` and `game-clips/**`; delete of malformed photo item reports a clear missing file reference error.

Thinking level: medium
Reason: small code change across existing page/module seam with low architectural complexity.

Current state:
- `game-day.html` owns inline prompt construction for `analyzeGame()` and `generateSummary()`.
- `js/game-day-wrapup.js` already exists as the wrap-up helper module used by page wiring tests.

Proposed state:
- Add sport-aware prompt builder helpers to `js/game-day-wrapup.js`.
- Resolve sport from `sport`, `game.sport`, `team.sport`, or `config.baseType`, then normalize wording for prompts.
- `game-day.html` passes current state into those helpers before calling Gemini.

Controls equivalence:
- Same AI model call path.
- Same Firestore writes (`practiceFeedItems`, `summary`).
- Same user-triggered actions and access path.

Blast radius comparison:
- Before: every wrap-up AI request forced soccer framing for all sports.
- After: only prompt text changes, scoped to the same two wrap-up actions.

Rollback:
- Revert the helper import usage and restore inline prompt strings.

What would change my mind:
- Evidence that another shared module already centralizes sport phrasing for wrap-up prompts.
- Evidence that `game-day.html` intentionally excludes non-soccer sports in wrap-up, which current specs contradict.

# Architecture role (fallback inline)

Current state:
- Debounced writes (`scoreSyncTimeout`, `opponentTimeout`, `playerTimeouts`, `liveFlagTimeout`) can outlive destructive reset/delete operations.
- `liveHasData` is used as a persisted-state signal for resume prompt, but not cleared by `resetTimer()` and `cancelGame()`.

Proposed state:
- Add one local utility in `track-live.html` to clear all pending `liveSync` timers atomically.
- Invoke that utility at the start of each destructive flow.
- Include `liveHasData: false` in reset/cancel game updates and update in-memory `currentGame.liveHasData` accordingly.

Blast radius:
- Limited to live tracker state transitions in one page.
- No schema changes, no external module changes.

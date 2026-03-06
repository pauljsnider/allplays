# Requirements role (fallback inline)

Objective: Address unresolved PR #174 review feedback in `track-live.html` only.

Required fixes:
1. Ensure all pending debounced `liveSync` timers are canceled before destructive reset/delete flows, specifically:
   - Start-over path in `startTimer()` when user declines resume
   - `resetTimer()` flow
   - `cancelGame()` flow
2. Ensure `liveHasData` is cleared in regular reset/cancel flows so resume prompt signal reflects true persisted activity after start-fresh actions.

Constraints:
- Minimal targeted changes.
- No unrelated refactors.
- Keep behavior consistent with existing reset helper semantics.

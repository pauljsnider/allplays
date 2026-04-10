Current state vs proposed state:
- Current: list reads (`getGames`) project shared docs per team, but single-doc reads bypass that projection.
- Proposed: reuse the same shared-game projection logic for single-doc reads and listeners.

Risk surface:
- Blast radius is limited to shared-game ID encoding and the code paths that read shared games or parse team/game composite keys.
- Backward compatibility matters because previously generated synthetic IDs may still exist in URLs or client state.

Recommendation:
- Switch `buildSharedGameSyntheticId()` to a delimiter-safe prefix.
- Keep `isSharedGameSyntheticId()` and `decodeSharedGameSyntheticId()` backward compatible with the legacy prefix.
- Parse composite `teamId::gameId` keys by the first delimiter only in the affected schedule flows.

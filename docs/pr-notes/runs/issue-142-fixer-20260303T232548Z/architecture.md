# Architecture Role Synthesis (Fallback)

## Note on orchestration tooling
Requested skills (`allplays-orchestrator-playbook`, `allplays-architecture-expert`) and `sessions_spawn` are not available in this environment. This artifact captures equivalent architecture analysis.

## Root cause model
Elapsed replay time is derived from affine form:
`elapsed = (now - start) * speed`
If speed changes without recomputing `start`, prior elapsed history is retroactively rescaled, causing jumps.

## Correct invariant
At speed-change time `t0`, continuity requires:
`elapsed_before(t0) == elapsed_after(t0)`
Therefore:
`newStart = t0 - elapsed_before(t0) / newSpeed`

## Minimal-safe patch strategy
- Keep replay timing logic centralized in `js/live-game-replay.js` helper(s).
- Ensure speed button flow in `js/live-game.js` rebases `replayStartTime` before mutating `replaySpeed` while playback is active.
- Add regression tests that assert continuity and non-jump behavior around one animation frame after speed change.

## Conflict resolution
- If helper-level behavior is already correct, prioritize test strengthening over broad refactor.
- Avoid modifying event-consumption loops unless continuity test proves still broken.

Objective: preserve video playback continuity while keeping the live-game page reactive to Firestore updates.

Current state:
- `setupVideoPanel()` resolves playback config and mutates DOM sources on each call.
- `handleGameUpdate()` invokes `setupVideoPanel()` for every game snapshot.

Proposed state:
- Resolve the next playback config on each snapshot.
- Compare previous vs next playback transport fields.
- Skip `src` rewrites when mode/source are stable; still refresh ancillary UI.

Control choice:
- Use a small pure helper in `js/live-game-video.js` to decide whether the player transport changed.
- Keep DOM mutation branching in `js/live-game.js` so the fix stays local to the page lifecycle.

Tradeoffs:
- Pros: minimal patch, unit-testable decision logic, low blast radius.
- Cons: does not fully decouple rendering from transport state, but that larger refactor is unnecessary for this defect.

Rollback:
- Revert the helper import and guard logic if regressions appear in video mode transitions.

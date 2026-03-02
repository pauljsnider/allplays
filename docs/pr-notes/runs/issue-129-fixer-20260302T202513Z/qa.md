# QA Role Synthesis

## Risk Surface
- Replay time math regressions could skip events or stall playback.
- Speed change handler wiring regressions could reintroduce jumps.

## Test Strategy
- Unit test continuity across speed changes.
- Unit test fallback path when speed changes while replaying but `replayStartTime` is invalid.
- Run focused Vitest file: `tests/unit/live-game-replay-speed.test.js`.

## Pass Criteria
- No jump in elapsed time at speed-change boundary.
- Future elapsed increments reflect new speed.
- Fallback path preserves `gameClockMs` continuity.

# Architecture Role Synthesis

## Root Cause
Elapsed replay time is derived from wall clock and speed multiplier. If speed changes without rebasing effective start time, prior elapsed time is retroactively multiplied.

## Design
- Keep elapsed calculation in shared replay helper.
- On speed change during active playback, compute elapsed at current speed, then derive a new start time for the target speed.
- Add fallback rebasing using `gameClockMs` when `replayStartTime` is not finite to avoid resets/jumps.

## Blast Radius
- Files: `js/live-game-replay.js`, `js/live-game.js`, replay speed unit tests.
- No Firestore schema, auth, routing, or multi-tenant access changes.

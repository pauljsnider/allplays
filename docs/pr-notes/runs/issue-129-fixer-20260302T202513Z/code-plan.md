# Code Role Synthesis

## Implementation Plan
1. Extend replay timing helper with speed-change rebasing function that supports fallback to `gameClockMs`.
2. Update live-game replay speed button handler to use shared helper.
3. Add unit coverage for fallback continuity and existing jump scenario.
4. Run targeted unit tests.

## Conflict Resolution
Requested orchestration skills/subagent APIs were unavailable in this runtime, so role outputs were synthesized manually and persisted at required paths.

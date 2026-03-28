# Architecture role analysis

- Current state: `getReplayStartTimeAfterSpeedChange` ignores `gameClockMs` when replay timing state is valid and recomputes elapsed from `nowMs`, `replayStartTimeMs`, and `replaySpeed`.
- Proposed state: Test data mirrors this by passing elapsed-consistent value (`10_000`) when validating rebasing continuity.
- Risk surface: Low and test-only; no runtime JS modules or replay control architecture changed.
- Blast radius: Confined to one unit test expectation setup path.

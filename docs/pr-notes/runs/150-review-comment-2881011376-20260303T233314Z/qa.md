# QA Role Notes

## Regression Focus
- Replay elapsed continuity at speed switch.
- Immediate post-switch frame progression correctness.
- Fallback path with invalid `replayStartTime`.

## Checks
- Run targeted suite: `tests/unit/live-game-replay-speed.test.js`.
- Verify all existing assertions remain green (no expectation changes).

## Risk Assessment
- Low risk: test-only modification with no production path edits.

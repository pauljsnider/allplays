# Requirements Role Notes

## Objective
Address review feedback on replay speed-change test fidelity by ensuring rebasing uses the same elapsed-time source as production behavior.

## Current vs Proposed
- Current: test computes elapsed (`10_000`) and separately passes a literal rebasing value.
- Proposed: pass the computed elapsed value directly so the test cannot drift from the calculated runtime value.

## Risk Surface
- Blast radius is unit-test only (`tests/unit/live-game-replay-speed.test.js`).
- No production code or runtime behavior changes.

## Assumptions
- Production speed-change flow continues to derive current elapsed at switch time (`js/live-game.js:1146-1159`).
- Reviewer intent is consistency between elapsed computation and rebasing input.

## Acceptance Criteria
1. The speed-change test passes computed elapsed into `getReplayStartTimeAfterSpeedChange`.
2. Replay speed unit suite passes with unchanged behavioral expectations.

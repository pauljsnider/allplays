# QA Role Synthesis (Fallback)

## Note on orchestration tooling
Requested skills (`allplays-orchestrator-playbook`, `allplays-qa-expert`) and `sessions_spawn` are not available in this environment. This artifact captures equivalent QA analysis.

## Regression risks
- Replay speed toggle can skip intermediate events if elapsed jumps.
- Replay clock may appear to jump even if event order is preserved.

## Test strategy
1. Unit test continuity around speed switch: elapsed at `t0 + frame` should equal old elapsed + frame*newSpeed.
2. Unit test “old-bug demonstration” value for non-rebased path as guard against accidental regression in test setup.
3. Validate fallback behavior when `replayStartTime` is invalid (uses `gameClockMs`).

## Manual sanity checklist
- Replay completed game, switch speed at ~0:10 from 1x to 4x while playing.
- Confirm no immediate clock jump and no missing play-by-play entries.
- Repeat with 2x->1x and 4x->1x transitions.

## Pass criteria
- Targeted replay-speed unit tests pass.
- No unrelated unit test regressions in a focused smoke run.

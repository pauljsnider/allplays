# QA Role Analysis (manual fallback)

## Failure mode under test
Resuming with existing `game.opponentStats` drops `fouls` into default `0` and save path persists corrupted values.

## Test strategy
- Add focused unit test around new pure hydration helper.
- First test asserts configured columns copy correctly and persisted `fouls` is preserved.
- Second test asserts missing `fouls` defaults to `0` (backward compatibility).

## Regression guardrails
- Run targeted new test file.
- Run full `tests/unit` suite to catch side effects in neighboring tracker helpers.

## Manual spot-check (optional)
- Resume a game with known opponent fouls > 0 in `live-tracker.html` and verify opponents panel + post-finish report.

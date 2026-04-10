# Code Role Notes

## Minimal Patch
- File: `tests/unit/live-game-replay-speed.test.js`
- Change: replace hardcoded `10_000` rebasing input with `elapsedAtSwitch`.

## Why This Patch
- Ensures one canonical elapsed source in the test.
- Prevents accidental divergence if timing setup changes.

## Validation Plan
1. Run `vitest` for replay-speed test file.
2. Confirm single-file diff and clean commit on PR branch.

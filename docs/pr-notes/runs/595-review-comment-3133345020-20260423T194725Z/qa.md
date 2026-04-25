# QA

## Test Strategy
Validate the live tracker retry path at the unit level, then confirm the full unit workflow still passes.

## Targeted Automated Coverage
- Add a retry-specific unit test proving the persisted queue retains the unsent remainder after a partial replay failure and clears only after the final retry succeeds.
- Keep queue persistence tests green.
- Keep live tracker start-over and opponent resume harnesses green after the new queue import wiring.

## Manual Checks
- Optional browser check: go offline during a live event, generate queued events, come back online, and refresh mid-retry to confirm events are still replayed on reload.

## Regression Risks
- Duplicate or skipped events if queue removal targets the wrong entry.
- Ordering regressions if later queued events are replayed after an earlier failure.
- Test harness drift when `live-tracker.js` gains new imports or browser globals.

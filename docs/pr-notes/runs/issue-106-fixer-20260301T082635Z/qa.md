# QA Role Output (manual fallback)

## Regression target
- Replay speed change continuity under active playback.

## Test strategy
- Unit-test timing helper behavior:
  - pre-fix baseline demonstrates retroactive jump with unchanged start time.
  - post-fix path rebases start time at speed change and keeps elapsed continuous.
  - verify continued progression at new rate after change.
- Run targeted tests for replay helper file.

## Manual smoke (recommended)
1. Start completed-game replay at 1x.
2. After a few seconds, switch to 10x/20x.
3. Confirm replay clock does not jump immediately and feed continues from current moment.

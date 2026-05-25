# QA Plan

## Automated Checks
- Update `splitPlayerStatsByVisibility` regression to expect public punctuated keys slugified as `astto` and `fg`.
- Add/keep coverage showing a punctuated base stat marked `topStat` produces non-zero leaderboard values when season stats use the split public storage output.
- Run focused unit tests: `npx vitest run tests/unit/stat-leaderboards.test.js --reporter=verbose`.

## Manual Checks
Not required. This is pure helper logic with unit coverage.

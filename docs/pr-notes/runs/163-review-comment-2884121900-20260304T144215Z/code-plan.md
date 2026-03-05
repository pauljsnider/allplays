# Patch Plan
1. Replace static long-running weekly expectation with computed expected dates over the actual visible window.
2. Add explicit cadence gap assertion (7-day intervals between neighboring occurrences).
3. Keep patch scoped to unit test file.

# Code Changes Applied
- Updated `tests/unit/recurrence-expand.test.js` long-running weekly test to:
  - compute `now`, `windowStart`, and `windowEnd` explicitly,
  - derive the expected weekly Mondays from the 2024-01-01 anchor across the full visible window,
  - assert exact returned date list and exact count,
  - assert every adjacent occurrence is exactly 7 days apart.

# Validation Run
- `cd /home/paul-bot1/.openclaw/workspace/worktrees/allplays-pr163-review-comment-2884121900 && /home/paul-bot1/.openclaw/workspace/allplays/node_modules/.bin/vitest run tests/unit/recurrence-expand.test.js`
- Result: pass (`5/5` tests in file).

# Residual Risks
- Test still focuses on weekly cadence; separate tests cover other recurrence frequencies.

# Commit Message Draft
Strengthen long-running weekly recurrence test for full-window gap detection

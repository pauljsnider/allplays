# QA notes

## QA Plan
- Run `npx vitest run tests/unit/live-tracker-save-complete.test.js` to verify the replay workflow assertion.
- Run `npx vitest run tests/unit/live-tracker-finish-batch-limit.test.js` to confirm chunked commit ordering and batch-limit behavior remain covered.

## Expected Behavior
- Replayed finish plans should enqueue event writes before aggregated stats writes because `commitFinishPlan` now commits event batches before stats batches.
- The game update remains a separate final update commit.

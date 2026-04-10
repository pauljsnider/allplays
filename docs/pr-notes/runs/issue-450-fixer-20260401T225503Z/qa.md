Primary regression to catch:
- Resumed game with persisted live data, partial score log, coach-entered final score differs from derived log score, save must preserve entered score.

Test intent:
1. Build a finish-save preparation with `scoreLogIsComplete: false` and a partial scoring log.
2. Assert no reconciliation log entry is added.
3. Assert `gameUpdate.homeScore` and `gameUpdate.awayScore` match the entered wrap-up score.
4. Assert `gameUpdate.status` is still `completed`.
5. Assert `live-tracker.js` uses the extracted helper so the page path stays covered.

Risk notes:
- False positives if the test only exercises `buildFinishCompletionPlan()`. That path is already covered and is not sufficient.
- Avoid broad DOM mocks. The branch decision is pure and should stay that way.

Validation:
- Run the targeted unit test file first to observe failure before the helper exists.
- Run the targeted finish-related unit suite after the patch.

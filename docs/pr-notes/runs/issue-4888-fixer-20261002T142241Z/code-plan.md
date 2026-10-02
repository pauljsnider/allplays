# Code Plan — Issue #4888

## Minimal patch

1. In `sendFeeUnpaidDueReminders`, replace `leasedSnap` with a leased `drainOrderedPages` pass ordered by `reminderDeliveryClaimExpiresAtMillis`, explicitly limited, and advanced by `startAfter`.
2. Add a local helper that filters unseen document paths and registers them before worker dispatch. Use it in both leased and upcoming page callbacks.
3. Reuse `runFeeReminderWorkers` at concurrency five and leave delivery transactions untouched.
4. Share one runtime deadline across both drains; synthesize a clean `maxRuntimeMs` summary when the second population has no remaining budget.
5. Log per-population summaries and one aggregate summary, then preserve the existing post-drain rethrow of the first retryable failure.
6. Add the three-page overlap/recovery integration regression and update source-wiring assertions.

## Prevention / learning

Every collection-group scheduler query must combine deterministic ordering, explicit limits, cursor progression, bounded workers, and invocation-wide identity deduplication when multiple discovery paths feed one processor.

## Validation

- `npx vitest run tests/unit/fee-due-reminders-source.test.js tests/unit/pre-event-reminder-dispatcher.test.js --reporter=verbose`
- `node node_modules/vitest/vitest.mjs run functions/test/notification-triggers.test.js --environment node`

## Recurrence risk

Medium: transactional delivery guards are strong, but pagination and cross-query scheduling need explicit later-page and duplicate-effect tests.

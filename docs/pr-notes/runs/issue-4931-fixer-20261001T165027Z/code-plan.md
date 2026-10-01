# Code plan

> The requested `allplays-code-expert` skill was unavailable, so this analysis emulates its minimal-safe-patch role.

1. Add failing focused tests for empty input, the concurrency ceiling, and successful outcome counters.
2. Add and export `runReminderWorkers({ items, concurrency, worker })` in `functions/pre-event-reminder-dispatcher-core.cjs`.
3. Validate the worker and positive-integer concurrency, return exact zero counters for empty input, and use shared-index worker loops capped by `Math.min(concurrency, items.length)`.
4. Count truthy fulfilled outcomes as sent; leave failed at zero and propagate rejections.
5. Run the single changed unit test file, recheck the overlap guard and diff, then commit both tests and implementation with issue `#4931` in the message.

`functions/index.js` remains untouched because runtime wiring belongs to the separate slice.

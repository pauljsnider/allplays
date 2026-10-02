# Code plan

> The requested `allplays-code-expert` skill was unavailable, so the role applied the specified minimal-safe-patch perspective directly.

1. Extend the existing reminder-core import with `drainOrderedPages` and `runReminderWorkers`.
2. Add fee-specific page, page-count, runtime, and fixed-concurrency constants near the existing lease constants.
3. Keep the current per-document reminder logic in one local worker without changing claim, eligibility, payment, preference, marker, or retry behavior.
4. Replace only the upcoming query's unbounded read with ordered bounded page loading and snapshot cursor progression.
5. Process each page through the fixed worker pool, retain the first retryable error, log the aggregate upcoming summary, then rethrow after selected work settles.
6. Keep the leased query unchanged and preserve path-based overlap suppression.
7. Upgrade only the fee-recipient collection-group test fake with ordering, limits, cursors, and query instrumentation.
8. Add the 51-recipient runtime regression and source contract assertions.
9. Run the two focused test files, review the diff, and commit the implementation and tests together for issue #4887.
